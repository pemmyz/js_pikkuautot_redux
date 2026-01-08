document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Constants ---
    const ASSET_FOLDER = 'auto/';
    const MAX_ASSETS = 9; // Only use 001.png - 009.png
    
    // --- Physics Settings (Planck) ---
    const pl = planck;
    const TIME_STEP = 1 / 60;
    
    // Dynamic physics iterations for optimization
    let velIter = 8;
    let posIter = 3;

    // --- State Variables ---
    let isPaused = false;
    let loadedTextures = [];
    
    // Track assigned gamepad indices
    let gamepadAssignments = { p1: null, p2: null }; 

    let gameParams = {
        playerSpeed: 100, // High speed
        enemySpeed: 70,   // Faster enemies
        turnSpeed: 2.5,  
        drift: 0.85      
    };
    
    let p1Score = 0;
    let p2Score = 0;

    // --- DOM Elements ---
    const p1ScoreEl = document.getElementById('p1Score');
    const p2ScoreEl = document.getElementById('p2Score');
    const helpMenu = document.getElementById('helpMenu');
    const customizeMenu = document.getElementById('customizeMenu');

    // --- THREE.JS Setup ---
    const container = document.getElementById('canvas-container');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.fog = new THREE.Fog(0x222222, 50, 150);

    // Camera (Will follow P1)
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 60, 30); 
    camera.lookAt(0, 0, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    const d = 100;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // --- PLANCK.JS Setup ---
    const world = pl.World(pl.Vec2(0, 0)); // Top down, no gravity

    // --- Game Entities ---
    let entities = []; 
    let player1, player2;
    const CAT_PLAYER = 0x0001;
    const CAT_ENEMY = 0x0002;
    const CAT_BULLET = 0x0004;
    const CAT_WALL = 0x0008;

    // --- Asset Loading ---
    const textureLoader = new THREE.TextureLoader();
    
    function loadAssets() {
        console.log("Loading assets...");
        const promises = [];
        for (let i = 1; i <= MAX_ASSETS; i++) {
            const num = i.toString().padStart(3, '0');
            const path = `${ASSET_FOLDER}${num}.png`;
            const p = new Promise((resolve) => {
                textureLoader.load(path, (tex) => { 
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;
                    tex.colorSpace = THREE.SRGBColorSpace;
                    loadedTextures.push(tex); 
                    resolve(); 
                }, undefined, () => resolve());
            });
            promises.push(p);
        }
        return Promise.all(promises);
    }

    // --- Helper for "Car" Physics ---
    function getLateralVelocity(body) {
        const currentRightNormal = body.getWorldVector(pl.Vec2(1, 0));
        const velocity = body.getLinearVelocity();
        const lateralMag = pl.Vec2.dot(currentRightNormal, velocity);
        return currentRightNormal.mul(lateralMag);
    }

    // --- Classes ---
    class Entity {
        constructor(mesh, body) {
            this.mesh = mesh;
            this.body = body;
            this.markedForDeletion = false;
            if (mesh) scene.add(mesh);
        }

        update() {
            if (!this.body || !this.mesh) return;
            const pos = this.body.getPosition();
            const angle = this.body.getAngle();
            this.mesh.position.set(pos.x, 0.5, pos.y); 
            this.mesh.rotation.y = -angle; 
        }

        destroy() {
            if (this.mesh) {
                scene.remove(this.mesh);
                if(this.mesh.geometry) this.mesh.geometry.dispose();
            }
            if (this.body) world.destroyBody(this.body);
        }
    }

    class Car extends Entity {
        constructor(x, y, isPlayer, playerIndex, texture) {
            const width = 1.8;
            const height = 3.8;

            // Visuals
            const geometry = new THREE.PlaneGeometry(width, height);
            const material = new THREE.MeshStandardMaterial({ 
                map: texture, transparent: true, alphaTest: 0.5, roughness: 0.5 
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.rotation.x = -Math.PI / 2; // Lie flat
            const containerMesh = new THREE.Group(); 
            containerMesh.add(mesh);

            // Physics
            const body = world.createBody({
                type: 'dynamic',
                position: pl.Vec2(x, y),
                linearDamping: 0.5, 
                angularDamping: 2.0 
            });

            body.createFixture(pl.Box(width / 2, height / 2), {
                density: 2.0, 
                friction: 0.3,
                restitution: 0.1,
                filterCategoryBits: isPlayer ? CAT_PLAYER : CAT_ENEMY,
                filterMaskBits: CAT_PLAYER | CAT_ENEMY | CAT_WALL | CAT_BULLET
            });

            super(containerMesh, body);
            
            this.isPlayer = isPlayer;
            this.playerIndex = playerIndex;
            this.shootCooldown = 0;
            this.baseTexture = texture;
            
            // Physics Props
            this.maxSteerAngle = Math.PI / 3;
            this.maxSpeed = isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;
            // High power for fast acceleration
            this.power = isPlayer ? 100 : 70; 
        }

        update(dt) {
            super.update();
            if (this.shootCooldown > 0) this.shootCooldown -= dt;
            
            // 1. Kill Lateral Velocity (The "Tire" effect)
            const lateralVel = getLateralVelocity(this.body);
            const driftFactor = this.isPlayer ? gameParams.drift : 1.0; 
            const impulse = lateralVel.neg().mul(this.body.getMass() * driftFactor);
            this.body.applyLinearImpulse(impulse, this.body.getWorldCenter());

            // 2. Angular Friction
            this.body.applyAngularImpulse( -0.1 * this.body.getAngularVelocity() * this.body.getMass() );

            // 3. Update Max Speed dynamically from slider
            this.maxSpeed = this.isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;

            // 4. Cleanup logic
            if (!this.isPlayer) {
                this.drive(1, 0); 
                const myPos = this.body.getPosition();
                const p1Pos = player1.body.getPosition();
                const dist = pl.Vec2.distance(myPos, p1Pos);
                if (dist > 120) this.markedForDeletion = true;
            }
        }

        drive(throttle, steer) {
            // Steering
            if (steer !== 0) {
                const turnForce = gameParams.turnSpeed * (throttle < 0 ? 1 : -1); 
                this.body.setAngularVelocity(steer * -turnForce);
            } else {
                this.body.setAngularVelocity(0);
            }

            // Acceleration
            if (throttle !== 0) {
                const forwardNormal = this.body.getWorldVector(pl.Vec2(0, 1));
                const currentSpeed = pl.Vec2.dot(this.body.getLinearVelocity(), forwardNormal);
                
                // Cap max speed
                if (Math.abs(currentSpeed) < this.maxSpeed) {
                    const force = forwardNormal.mul(throttle * this.power);
                    this.body.applyForce(force, this.body.getWorldCenter());
                }
            }
        }

        shoot() {
            if (this.shootCooldown > 0) return;
            const pos = this.body.getPosition();
            const direction = this.body.getWorldVector(pl.Vec2(0, 1));
            
            const bx = pos.x + direction.x * 3;
            const by = pos.y + direction.y * 3;
            
            createBullet(bx, by, direction.x * 60, direction.y * 60, this.playerIndex);
            this.shootCooldown = 0.2;
        }
    }

    function createBullet(x, y, vx, vy, ownerIndex) {
        const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const mesh = new THREE.Mesh(geo, mat);
        
        const body = world.createBody({
            type: 'dynamic',
            position: pl.Vec2(x, y),
            bullet: true
        });
        body.createFixture(pl.Circle(0.15), {
            filterCategoryBits: CAT_BULLET,
            filterMaskBits: CAT_ENEMY | CAT_WALL
        });
        body.setLinearVelocity(pl.Vec2(vx, vy));

        const ent = new Entity(mesh, body);
        ent.isBullet = true;
        ent.owner = ownerIndex;
        ent.life = 1.0;
        ent.update = function(dt) {
            Entity.prototype.update.call(this);
            this.life -= dt;
            if (this.life <= 0) this.markedForDeletion = true;
        };
        entities.push(ent);
    }

    // --- Environment ---
    function createCity() {
        // Ground
        const planeGeo = new THREE.PlaneGeometry(400, 400);
        const planeMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
        const ground = new THREE.Mesh(planeGeo, planeMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Road Lines
        for(let i=-200; i<200; i+=10) {
            const mark = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 4), 
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            mark.rotation.x = -Math.PI / 2;
            mark.position.set(0, 0.05, i);
            scene.add(mark);
        }

        createWall(-40, 0, 2, 400);
        createWall(40, 0, 2, 400);

        const boxGeo = new THREE.BoxGeometry(1,1,1);
        for(let z=-200; z<200; z+=12) {
            createBuildingBlock(-35, z, boxGeo);
            createBuildingBlock(35, z, boxGeo);
        }
    }

    function createBuildingBlock(x, z, geo) {
        const h = Math.random() * 15 + 5;
        const w = Math.random() * 8 + 6;
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff }));
        mesh.position.set(x, h/2, z);
        mesh.scale.set(w, h, w);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        
        const body = world.createBody(pl.Vec2(x, z));
        body.createFixture(pl.Box(w/2, w/2), { filterCategoryBits: CAT_WALL });
    }

    function createWall(x, z, w, h) {
        const body = world.createBody(pl.Vec2(x, z));
        body.createFixture(pl.Box(w/2, h/2), { filterCategoryBits: CAT_WALL });
    }

    // --- Logic ---
    function spawnTraffic() {
        if (loadedTextures.length === 0) return;
        
        const limit = parseInt(document.getElementById('densitySlider').value) || 20;
        const count = entities.filter(e => e instanceof Car && !e.isPlayer).length;
        if (count >= limit) return;

        const p1Z = player1.body.getPosition().y;
        const laneX = (Math.random() * 30) - 15;
        const spawnZ = p1Z + 60 + (Math.random() * 40);

        const tex = loadedTextures[Math.floor(Math.random() * loadedTextures.length)];
        const car = new Car(laneX, spawnZ, false, 0, tex);
        
        if (Math.random() > 0.5) {
            car.body.setAngle(Math.PI); 
        } else {
            car.body.setAngle(0); 
        }

        entities.push(car);
    }

    // --- Collision ---
    world.on('begin-contact', (contact) => {
        const a = contact.getFixtureA().getBody();
        const b = contact.getFixtureB().getBody();
        
        const entA = entities.find(e => e.body === a);
        const entB = entities.find(e => e.body === b);
        if(!entA || !entB) return;

        if(entA.isBullet || entB.isBullet) {
            const bullet = entA.isBullet ? entA : entB;
            const target = entA.isBullet ? entB : entA;
            
            if(target instanceof Car && !target.isPlayer) {
                bullet.markedForDeletion = true;
                target.markedForDeletion = true;
                if(bullet.owner === 1) p1Score += 100;
                else p2Score += 100;
                updateHUD();
            } else if (!target.isPlayer) {
                bullet.markedForDeletion = true; // Hit wall
            }
        }
    });

    function updateHUD() {
        p1ScoreEl.innerText = `P1: ${p1Score}`;
        p2ScoreEl.innerText = `P2: ${p2Score}`;
    }

    // --- Input ---
    const keys = {};
    window.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
    window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

    // --- Main Loop ---
    let lastTime = 0;
    function animate(time) {
        requestAnimationFrame(animate);
        const dt = Math.min((time - lastTime) / 1000, 0.05);
        lastTime = time;

        if (loadedTextures.length < 2) return; 
        if (isPaused) return;

        // 1. Spawning
        if (Math.random() < 0.02) spawnTraffic();

        // 2. Physics
        world.step(TIME_STEP, velIter, posIter);

        // 3. Player Control & Gamepad Handling
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        // Logic: Allow players to "Join" by pressing face buttons (0,1,2,3)
        for (let i = 0; i < gamepads.length; i++) {
            const gp = gamepads[i];
            if (gp) {
                // Check if any face button is pressed to join
                const btnPressed = gp.buttons.some((b, idx) => idx < 4 && b.pressed);
                if (btnPressed) {
                    if (gamepadAssignments.p1 === null && gamepadAssignments.p2 !== gp.index) {
                        gamepadAssignments.p1 = gp.index;
                        console.log(`Gamepad ${i} assigned to P1`);
                    } else if (gamepadAssignments.p2 === null && gamepadAssignments.p1 !== gp.index) {
                        gamepadAssignments.p2 = gp.index;
                        console.log(`Gamepad ${i} assigned to P2`);
                    }
                }
            }
        }

        if (player1) {
            let throttle = 0;
            let steer = 0;
            let shoot = false;

            // Keyboard P1
            if (keys['arrowup']) throttle = 1;
            if (keys['arrowdown']) throttle = -1;
            if (keys['arrowleft']) steer = -1; 
            if (keys['arrowright']) steer = 1;
            if (keys[' ']) shoot = true;

            // Gamepad P1
            if (gamepadAssignments.p1 !== null && gamepads[gamepadAssignments.p1]) {
                const gp = gamepads[gamepadAssignments.p1];
                const deadzone = 0.2;

                // Steering: Left Stick X (Axis 0) or D-Pad
                if (Math.abs(gp.axes[0]) > deadzone) steer = gp.axes[0];
                else if (gp.buttons[14]?.pressed) steer = -1; 
                else if (gp.buttons[15]?.pressed) steer = 1;

                // Throttle: A (Button 0) or D-Pad Up
                if (gp.buttons[0]?.pressed) throttle = 1;
                else if (gp.buttons[12]?.pressed) throttle = 1;

                // Reverse: D-Pad Down or Left Stick Down (Axis 1)
                if (gp.buttons[13]?.pressed || gp.axes[1] > 0.5) throttle = -1;

                // Shoot: B(1), X(2), Y(3), RB(5), RT(7)
                if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed || gp.buttons[3]?.pressed ||
                    gp.buttons[5]?.pressed || (gp.buttons[7] && (gp.buttons[7].pressed || gp.buttons[7].value > 0.5))) {
                    shoot = true;
                }
            }
            
            player1.drive(throttle, steer);
            if (shoot) player1.shoot();
        }

        if (player2) {
            let throttle = 0;
            let steer = 0;
            let shoot = false;

            // Keyboard P2
            if (keys['w']) throttle = 1;
            if (keys['s']) throttle = -1;
            if (keys['a']) steer = -1;
            if (keys['d']) steer = 1;
            if (keys['f']) shoot = true;

            // Gamepad P2
            if (gamepadAssignments.p2 !== null && gamepads[gamepadAssignments.p2]) {
                const gp = gamepads[gamepadAssignments.p2];
                const deadzone = 0.2;

                // Steering
                if (Math.abs(gp.axes[0]) > deadzone) steer = gp.axes[0];
                else if (gp.buttons[14]?.pressed) steer = -1;
                else if (gp.buttons[15]?.pressed) steer = 1;

                // Throttle
                if (gp.buttons[0]?.pressed) throttle = 1;
                else if (gp.buttons[12]?.pressed) throttle = 1;

                // Reverse
                if (gp.buttons[13]?.pressed || gp.axes[1] > 0.5) throttle = -1;

                // Shoot: B, X, Y, RB, RT
                if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed || gp.buttons[3]?.pressed ||
                    gp.buttons[5]?.pressed || (gp.buttons[7] && (gp.buttons[7].pressed || gp.buttons[7].value > 0.5))) {
                    shoot = true;
                }
            }
            
            player2.drive(throttle, steer);
            if (shoot) player2.shoot();
        }

        // 4. Update Entities & Camera
        for (let i = entities.length - 1; i >= 0; i--) {
            entities[i].update(dt);
            if (entities[i].markedForDeletion) {
                entities[i].destroy();
                entities.splice(i, 1);
            }
        }

        // Camera Follow P1
        if (player1 && player1.mesh) {
            const targetX = player1.mesh.position.x;
            const targetZ = player1.mesh.position.z + 20; 
            
            camera.position.x += (targetX - camera.position.x) * 0.1;
            camera.position.z += (targetZ - camera.position.z) * 0.1;
            camera.lookAt(targetX, 0, targetZ - 30);
        }
        
        // Light follows P1
        if (player1 && player1.mesh) {
            dirLight.position.x = player1.mesh.position.x + 50;
            dirLight.position.z = player1.mesh.position.z + 50;
            dirLight.target.position.set(player1.mesh.position.x, 0, player1.mesh.position.z);
            dirLight.target.updateMatrixWorld();
        }

        renderer.render(scene, camera);
    }

    // --- Start ---
    function startGame() {
        entities.forEach(e => e.destroy());
        entities = [];
        
        player1 = new Car(5, 0, true, 1, loadedTextures[0]);
        player2 = new Car(-5, 0, true, 2, loadedTextures[1]);

        entities.push(player1);
        entities.push(player2);
    }

    // --- Boot ---
    loadAssets().then(() => {
        createCity();
        startGame();
        animate(0);
    });

    // --- UI & Event Listeners ---
    function toggleMenu(menu) {
        const isHidden = menu.classList.contains('hidden');
        helpMenu.classList.add('hidden');
        customizeMenu.classList.add('hidden');
        
        if (isHidden) {
            menu.classList.remove('hidden');
            isPaused = true;
        } else {
            isPaused = false;
        }
    }

    document.getElementById('customizeButton').addEventListener('click', () => toggleMenu(customizeMenu));
    document.getElementById('helpButton').addEventListener('click', () => toggleMenu(helpMenu));
    document.querySelector('.close-help').addEventListener('click', () => toggleMenu(helpMenu));
    document.querySelector('.close-customize').addEventListener('click', () => toggleMenu(customizeMenu));

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.key.toLowerCase() === 'c') toggleMenu(customizeMenu);
        if (e.key.toLowerCase() === 'h') toggleMenu(helpMenu);
    });

    // Graphics Toggles
    document.getElementById('shadowsToggle').addEventListener('change', (e) => {
        dirLight.castShadow = e.target.checked;
        renderer.shadowMap.autoUpdate = e.target.checked;
        if(!e.target.checked) renderer.clearTarget(dirLight.shadow.map);
    });

    document.getElementById('lowResToggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            renderer.setPixelRatio(0.5); 
        } else {
            renderer.setPixelRatio(window.devicePixelRatio); 
        }
    });

    // Physics Optimization Toggle
    document.getElementById('litePhysicsToggle').addEventListener('change', (e) => {
        if (e.target.checked) {
            // Low precision (Faster CPU)
            velIter = 2;
            posIter = 1;
        } else {
            // High precision (Slower CPU)
            velIter = 8;
            posIter = 3;
        }
    });

    const updateSlider = (id, paramKey, displayId) => {
        const el = document.getElementById(id);
        const disp = document.getElementById(displayId);
        if(el) {
            el.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                gameParams[paramKey] = val;
                if(disp) disp.innerText = val;
            });
        }
    };

    updateSlider('playerSpeedSlider', 'playerSpeed', 'playerSpeedValue');
    updateSlider('enemySpeedSlider', 'enemySpeed', 'enemySpeedValue');
    
    document.getElementById('densitySlider').addEventListener('input', (e) => {
        document.getElementById('densityValue').innerText = e.target.value;
    });

    document.getElementById('newGameButton').onclick = () => {
        toggleMenu(customizeMenu); 
        startGame();
    };
});
