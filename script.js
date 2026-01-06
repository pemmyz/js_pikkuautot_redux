document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Constants ---
    const ASSET_FOLDER = 'auto/';
    const MAX_ASSETS = 9; // Only use 001.png - 009.png
    
    // --- Physics Settings (Planck) ---
    const pl = planck;
    const TIME_STEP = 1 / 60;
    const VELOCITY_ITERATIONS = 8;
    const POSITION_ITERATIONS = 3;

    // --- State Variables ---
    let isPaused = false;
    let loadedTextures = [];
    let gameParams = {
        playerSpeed: 40, // Horsepower
        enemySpeed: 20,
        turnSpeed: 2.5,  // Steering speed
        drift: 0.85      // 1.0 = heavy grip (F1), 0.1 = ice (drift)
    };
    
    let p1Score = 0;
    let p2Score = 0;
    let fps = 0;

    // --- DOM Elements ---
    const p1ScoreEl = document.getElementById('p1Score');
    const p2ScoreEl = document.getElementById('p2Score');
    const fpsEl = document.getElementById('fpsCounter');
    const helpMenu = document.getElementById('helpMenu');
    const customizeMenu = document.getElementById('customizeMenu');

    // --- THREE.JS Setup ---
    const container = document.getElementById('canvas-container');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
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
    // Increase shadow cam area
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
    // Decomposes velocity into forward and lateral components
    function getLateralVelocity(body) {
        const currentRightNormal = body.getWorldVector(pl.Vec2(1, 0));
        const velocity = body.getLinearVelocity();
        // Dot product gives magnitude in that direction
        const lateralMag = pl.Vec2.dot(currentRightNormal, velocity);
        return currentRightNormal.mul(lateralMag);
    }

    function getForwardVelocity(body) {
        const currentForwardNormal = body.getWorldVector(pl.Vec2(0, 1)); // Facing Up
        const velocity = body.getLinearVelocity();
        const forwardMag = pl.Vec2.dot(currentForwardNormal, velocity);
        return currentForwardNormal.mul(forwardMag);
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
            // ThreeJS Y is Up. Physics Y is "North". Map Physics(x,y) to Three(x, z).
            this.mesh.position.set(pos.x, 0.5, pos.y); 
            this.mesh.rotation.y = -angle; // Rotate mesh to match physics
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
            const containerMesh = new THREE.Group(); // Wrapper for rotation
            containerMesh.add(mesh);

            // Physics
            const body = world.createBody({
                type: 'dynamic',
                position: pl.Vec2(x, y),
                linearDamping: 0.5, // Slow down naturally
                angularDamping: 2.0 // Stop spinning naturally
            });

            body.createFixture(pl.Box(width / 2, height / 2), {
                density: 2.0, // Heavier cars feel better
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
            this.power = isPlayer ? 30 : 15; 
        }

        update(dt) {
            super.update();
            if (this.shootCooldown > 0) this.shootCooldown -= dt;
            
            // 1. Kill Lateral Velocity (The "Tire" effect)
            // Get sideways velocity vector
            const lateralVel = getLateralVelocity(this.body);
            // Apply impulse against it to kill it (Friction)
            // Multiply by < 1.0 to allow drifting.
            const driftFactor = this.isPlayer ? gameParams.drift : 1.0; 
            const impulse = lateralVel.neg().mul(this.body.getMass() * driftFactor);
            this.body.applyLinearImpulse(impulse, this.body.getWorldCenter());

            // 2. Angular Friction (Prevent spinning forever)
            this.body.applyAngularImpulse( -0.1 * this.body.getAngularVelocity() * this.body.getMass() );

            // 3. Cleanup logic
            if (!this.isPlayer) {
                // Simple AI: Just drive forward
                this.drive(1, 0); 

                // Despawn if too far from P1
                const myPos = this.body.getPosition();
                const p1Pos = player1.body.getPosition();
                const dist = pl.Vec2.distance(myPos, p1Pos);
                if (dist > 100) this.markedForDeletion = true;
            }
        }

        // throttle: -1 (reverse) to 1 (forward)
        // steer: -1 (left) to 1 (right)
        drive(throttle, steer) {
            // Steering
            // Real cars steer only when moving (mostly), but for arcade feel allow pivot or simple turn
            // We'll apply angular velocity based on steer
            if (steer !== 0) {
                // Turn speed increases with speed slightly, but clamped
                const turnForce = gameParams.turnSpeed * (throttle < 0 ? 1 : -1); // Reverse steering inversion
                this.body.setAngularVelocity(steer * -turnForce);
            } else {
                this.body.setAngularVelocity(0);
            }

            // Acceleration
            if (throttle !== 0) {
                const forwardNormal = this.body.getWorldVector(pl.Vec2(0, 1));
                const force = forwardNormal.mul(throttle * this.power);
                this.body.applyForce(force, this.body.getWorldCenter());
            }
        }

        shoot() {
            if (this.shootCooldown > 0) return;
            const pos = this.body.getPosition();
            const angle = this.body.getAngle();
            const vx = -Math.sin(angle) * 60;
            const vy = -Math.cos(angle) * 60; // Shoot in facing direction (physics 0,1 is Up/North)
            
            // Need to fix angle math. In Planck:
            // Angle 0 = Up (if we map texture that way). 
            // Our car textures face UP. Planck default 0 is Right.
            // Adjust: WorldVector(0,1) is the direction the car texture faces.
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

        // Road Lines (Infinite scrolling illusion handled by just drawing a lot of them)
        for(let i=-200; i<200; i+=10) {
            const mark = new THREE.Mesh(
                new THREE.PlaneGeometry(1, 4), 
                new THREE.MeshBasicMaterial({ color: 0xffffff })
            );
            mark.rotation.x = -Math.PI / 2;
            mark.position.set(0, 0.05, i);
            scene.add(mark);
        }

        // Invisible walls to keep P1 on road (Left/Right)
        createWall(-40, 0, 2, 400);
        createWall(40, 0, 2, 400);

        // Buildings on sides
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
        // Physics
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
        const count = entities.filter(e => e instanceof Car && !e.isPlayer).length;
        if (count > 20) return; // Cap traffic

        // Spawn relative to Player 1
        const p1Z = player1.body.getPosition().y;
        
        // Random lane (-20 to 20)
        const laneX = (Math.random() * 30) - 15;
        // Spawn ahead
        const spawnZ = p1Z + 60 + (Math.random() * 40);

        const tex = loadedTextures[Math.floor(Math.random() * loadedTextures.length)];
        const car = new Car(laneX, spawnZ, false, 0, tex);
        
        // Point down the road (South) or Up?
        // Let's make them drive same direction as player
        // P1 starts facing North (Up). 
        // 50% chance to be oncoming traffic
        if (Math.random() > 0.5) {
            car.body.setAngle(Math.PI); // Face South (Oncoming)
        } else {
            car.body.setAngle(0); // Face North (Same way)
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

        // Bullet Hit
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

        if (loadedTextures.length < 2) return; // Wait for assets

        if (keys['c']) { customizeMenu.classList.remove('hidden'); isPaused = true; }
        else { customizeMenu.classList.add('hidden'); isPaused = false; }

        if (isPaused) return;

        // 1. Spawning
        if (Math.random() < 0.02) spawnTraffic();

        // 2. Physics
        world.step(TIME_STEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS);

        // 3. Player Control
        if (player1) {
            let throttle = 0;
            let steer = 0;
            if (keys['arrowup']) throttle = 1;
            if (keys['arrowdown']) throttle = -1;
            if (keys['arrowleft']) steer = 1; // Left turns Positive in Planck angle? No, usually CCW is positive
            if (keys['arrowright']) steer = -1;
            
            player1.drive(throttle, steer);
            if (keys[' ']) player1.shoot();
        }

        if (player2) {
            let throttle = 0;
            let steer = 0;
            if (keys['w']) throttle = 1;
            if (keys['s']) throttle = -1;
            if (keys['a']) steer = 1;
            if (keys['d']) steer = -1;
            player2.drive(throttle, steer);
            if (keys['f']) player2.shoot();
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
            // Smooth follow
            const targetX = player1.mesh.position.x;
            const targetZ = player1.mesh.position.z + 20; // +20 offsets camera "below" car so car is center-ish
            
            camera.position.x += (targetX - camera.position.x) * 0.1;
            camera.position.z += (targetZ - camera.position.z) * 0.1;
            
            // Look slightly ahead of car
            camera.lookAt(targetX, 0, targetZ - 30);
        }
        
        // Light follows P1 to ensure shadows work
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
        
        // P1 start
        player1 = new Car(5, 0, true, 1, loadedTextures[0]);
        // P2 start
        player2 = new Car(-5, 0, true, 2, loadedTextures[1]);

        entities.push(player1);
        entities.push(player2);
    }

    loadAssets().then(() => {
        createCity();
        startGame();
        animate(0);
    });
    
    // Sliders
    document.getElementById('playerSpeedSlider').addEventListener('input', e => gameParams.playerSpeed = parseInt(e.target.value));
    document.getElementById('enemySpeedSlider').addEventListener('input', e => gameParams.enemySpeed = parseInt(e.target.value));
    document.getElementById('newGameButton').onclick = startGame;
});
