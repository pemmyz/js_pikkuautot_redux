document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Constants ---
    const ASSET_FOLDER = 'auto/';
    const MAX_ASSETS = 9; 
    
    // --- Physics Settings (Planck) ---
    const pl = planck;
    const TIME_STEP = 1 / 60;
    
    // Dynamic physics iterations for optimization
    let velIter = 8;
    let posIter = 3;

    // --- State Variables ---
    let isPaused = false;
    let gameActive = false;
    let loadedTextures = [];
    let currentMapType = 'default';
    
    // Track assigned gamepad indices
    let gamepadAssignments = { p1: null, p2: null }; 

    let gameParams = {
        playerSpeed: 100, // High speed
        enemySpeed: 70,   // Faster enemies
        turnSpeed: 2.5,  
        drift: 0.85,
        trafficCount: 20     
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
    // RESTORED: Camera Position
    camera.position.set(0, 60, 30); 
    camera.lookAt(0, 0, 0);

    // Lighting
    // RESTORED: Specific lighting settings
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
    let trafficPool = [];
    let player1, player2;
    let mapGrid = [];
    let roadTiles = [];
    
    const CAT_PLAYER = 0x0001;
    const CAT_ENEMY = 0x0002;
    const CAT_BULLET = 0x0004;
    const CAT_WALL = 0x0008;

    // --- Asset Loading ---
    const textureLoader = new THREE.TextureLoader();
    
    function loadAssets() {
        if(loadedTextures.length > 0) return Promise.resolve();
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
                }, undefined, () => {
                    // Fallback
                    const c = document.createElement('canvas'); c.width=64; c.height=128;
                    const ctx = c.getContext('2d');
                    ctx.fillStyle = `hsl(${i*40},70%,50%)`; ctx.fillRect(0,0,64,128);
                    ctx.fillStyle='#000'; ctx.fillRect(10,10,44,20);
                    const t = new THREE.CanvasTexture(c);
                    t.magFilter = THREE.NearestFilter;
                    loadedTextures.push(t);
                    resolve();
                });
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
            // RESTORED: Car Dimensions
            const width = 1.8;
            const height = 3.8;

            // RESTORED: PlaneGeometry (2D Sprite style)
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

            // 4. Cleanup logic (Despawn handled by updateTraffic now)
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

    function createExplosion(pos) {
        const geo = new THREE.BoxGeometry(0.4,0.4,0.4);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff5500 });
        for(let i=0; i<8; i++) {
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            scene.add(mesh);
            const vel = new THREE.Vector3((Math.random()-0.5), Math.random(), (Math.random()-0.5));
            const ent = {
                mesh: mesh, vel: vel, life: 0.8,
                update: function() {
                    this.mesh.position.add(this.vel);
                    this.life -= 0.05;
                    if(this.life <= 0) { scene.remove(this.mesh); this.markedForDeletion = true; }
                }, destroy: function(){}
            };
            entities.push(ent);
        }
    }

    // --- Environment Generation (Restored) ---
    
    // RESTORED: Specific createCity logic from snippet
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
        
        // Define Road Tiles manually for this static map so traffic logic works
        roadTiles = [];
        for(let z=-200; z<200; z+=20) {
            roadTiles.push({x: -15, z: z});
            roadTiles.push({x: 0, z: z});
            roadTiles.push({x: 15, z: z});
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
    
    // --- Maze Generation for other modes ---
    const BLOCK_SIZE = 20; 
    class Rect {
        constructor(x, y, w, h) {
            this.x1 = x; this.y1 = y;
            this.x2 = x + w; this.y2 = y + h;
            this.center = [Math.floor((this.x1 + this.x2) / 2), Math.floor((this.y1 + this.y2) / 2)];
        }
        intersect(other) {
            return (this.x1 < other.x2 + 1 && this.x2 > other.x1 - 1 &&
                    this.y1 < other.y2 + 1 && this.y2 > other.y1 - 1);
        }
    }

    function generateMazeData(width, height) {
        let grid = [];
        for (let i = 0; i < height; i++) {
            let row = [];
            for (let j = 0; j < width; j++) row.push('#');
            grid.push(row);
        }
        let rooms = [];
        const maxRooms = Math.floor((width * height) / 50);
        const roomMin = 3, roomMax = 8;
        for (let r = 0; r < maxRooms; r++) {
            let w = Math.floor(Math.random() * (roomMax - roomMin + 1)) + roomMin;
            let h = Math.floor(Math.random() * (roomMax - roomMin + 1)) + roomMin;
            let x = Math.floor(Math.random() * ((width - w - 1) / 2)) * 2 + 1;
            let y = Math.floor(Math.random() * ((height - h - 1) / 2)) * 2 + 1;
            let newRoom = new Rect(x, y, w, h);
            let failed = false;
            for (let other of rooms) {
                if (newRoom.intersect(other)) { failed = true; break; }
            }
            if (!failed) {
                for (let i = newRoom.y1; i < newRoom.y2; i++) {
                    for (let j = newRoom.x1; j < newRoom.x2; j++) {
                        if (i > 0 && i < height-1 && j > 0 && j < width-1) grid[i][j] = ' ';
                    }
                }
                if (rooms.length > 0) {
                    let [prevX, prevY] = rooms[rooms.length - 1].center;
                    let [newX, newY] = newRoom.center;
                    for (let xCorr = Math.min(prevX, newX); xCorr <= Math.max(prevX, newX); xCorr++) {
                        grid[prevY][xCorr] = ' ';
                        if(prevY+1 < height) grid[prevY+1][xCorr] = ' ';
                    }
                    for (let yCorr = Math.min(prevY, newY); yCorr <= Math.max(prevY, newY); yCorr++) {
                        grid[yCorr][newX] = ' ';
                        if(newX+1 < width) grid[yCorr][newX+1] = ' ';
                    }
                }
                rooms.push(newRoom);
            }
        }
        let roads = [];
        for(let z=0; z<height; z++) {
            for(let x=0; x<width; x++) {
                if(grid[z][x] === ' ') {
                    roads.push({ 
                        x: (x * BLOCK_SIZE) - (width * BLOCK_SIZE / 2), 
                        z: (z * BLOCK_SIZE) - (height * BLOCK_SIZE / 2) 
                    });
                }
            }
        }
        return { grid, roads };
    }

    // --- Logic ---
    function spawnTraffic() {
        if (loadedTextures.length === 0) return;
        
        const limit = gameParams.trafficCount;
        if (trafficPool.length < limit) {
             let x, z, angle;
             const tex = loadedTextures[Math.floor(Math.random() * loadedTextures.length)];

             if (currentMapType === 'default') {
                 const laneX = (Math.random() * 30) - 15;
                 const p1Z = player1 ? player1.body.getPosition().y : 0;
                 // Spawn mostly ahead
                 z = p1Z + 60 + (Math.random() * 100);
                 x = laneX;
             } else {
                 if(roadTiles.length === 0) return;
                 const spot = roadTiles[Math.floor(Math.random() * roadTiles.length)];
                 x = spot.x;
                 z = spot.z;
             }
             
             // Random orientation (mostly opposite flow)
             angle = (Math.random() > 0.5) ? Math.PI : 0;

             const car = new Car(x, z, false, 0, tex);
             car.body.setAngle(angle);
             entities.push(car);
             trafficPool.push(car);
        } else if (trafficPool.length > limit) {
             const rem = trafficPool.pop();
             rem.markedForDeletion = true;
        }
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
                // Move offscreen to recycle
                target.body.setPosition(pl.Vec2(9999, 9999));
                
                if(bullet.owner === 1) p1Score += 100;
                else p2Score += 100;
                createExplosion(target.mesh.position);
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

        if (!gameActive || isPaused) return;

        // 1. Spawning
        if (Math.random() < 0.05) spawnTraffic();

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
                if (Math.abs(gp.axes[0]) > 0.2) steer = gp.axes[0];
                if (gp.buttons[0]?.pressed || gp.buttons[12]?.pressed) throttle = 1;
                if (gp.buttons[13]?.pressed || gp.axes[1] > 0.5) throttle = -1;
                if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) shoot = true;
            }
            player1.drive(throttle, steer);
            if (shoot) player1.shoot();
        }

        if (player2) {
            let throttle = 0;
            let steer = 0;
            let shoot = false;
            // Keyboard P2
            if (keys['w']) throttle = 1; if (keys['s']) throttle = -1;
            if (keys['a']) steer = -1; if (keys['d']) steer = 1;
            if (keys['f']) shoot = true;
            // Gamepad P2
            if (gamepadAssignments.p2 !== null && gamepads[gamepadAssignments.p2]) {
                const gp = gamepads[gamepadAssignments.p2];
                if (Math.abs(gp.axes[0]) > 0.2) steer = gp.axes[0];
                if (gp.buttons[0]?.pressed) throttle = 1;
                if (gp.buttons[1]?.pressed) shoot = true;
            }
            player2.drive(throttle, steer);
            if (shoot) player2.shoot();
        }

        // 4. Update Entities & Camera
        if(player1 && player1.body) {
             const p1Pos = player1.body.getPosition();
             // Traffic Update Logic (Bottom to Top Recycling)
             const viewDist = 180;
             const spawnDist = 140;
             trafficPool.forEach(car => {
                car.update(dt);
                const cPos = car.body.getPosition();
                // Simple AI
                car.drive(0.5, 0); 
                if(Math.random()<0.01) car.body.setAngularVelocity((Math.random()-0.5));
                
                const dist = pl.Vec2.distance(cPos, p1Pos);
                if (dist > viewDist) {
                    // Recycle to "Bottom" relative to player (Assuming moving North/-Z)
                    // +Z is "behind"
                    const targetZ = p1Pos.y + spawnDist;
                    let valid = null;
                    if(currentMapType === 'default') {
                        valid = {x: (Math.random()*40)-20, z: targetZ};
                    } else if (roadTiles.length > 0) {
                        const candidates = roadTiles.filter(t => Math.abs(t.z - targetZ) < 50);
                        if(candidates.length) valid = candidates[Math.floor(Math.random()*candidates.length)];
                        else valid = roadTiles[Math.floor(Math.random()*roadTiles.length)];
                    }
                    if(valid) {
                         car.body.setPosition(pl.Vec2(valid.x, valid.z));
                         car.body.setLinearVelocity(pl.Vec2(0, -gameParams.enemySpeed/2));
                         car.body.setAngle(Math.PI);
                         car.body.setAngularVelocity(0);
                    }
                }
             });
        }
        
        for (let i = entities.length - 1; i >= 0; i--) {
            if(!trafficPool.includes(entities[i])) entities[i].update(dt); // Cars updated above
            if (entities[i].markedForDeletion) {
                entities[i].destroy();
                entities.splice(i, 1);
                const idx = trafficPool.indexOf(entities[i]);
                if(idx > -1) trafficPool.splice(idx, 1);
            }
        }

        // RESTORED: Specific Camera Follow Logic
        if (player1 && player1.mesh) {
            const targetX = player1.mesh.position.x;
            const targetZ = player1.mesh.position.z + 20; 
            
            camera.position.x += (targetX - camera.position.x) * 0.1;
            camera.position.z += (targetZ - camera.position.z) * 0.1;
            camera.lookAt(targetX, 0, targetZ - 30);
            
            // Light follows P1
            dirLight.position.x = player1.mesh.position.x + 50;
            dirLight.position.z = player1.mesh.position.z + 50;
            dirLight.target.position.set(player1.mesh.position.x, 0, player1.mesh.position.z);
            dirLight.target.updateMatrixWorld();
        }

        renderer.render(scene, camera);
    }

    // --- Start ---
    window.startGameWithMap = function(type) {
        currentMapType = type;
        document.getElementById('startScreen').classList.add('hidden');
        document.getElementById('customizeMenu').classList.add('hidden');
        document.getElementById('gameHeader').classList.remove('hidden');
        document.getElementById('hud').classList.remove('hidden');
        isPaused = false;
        
        loadAssets().then(() => {
            entities.forEach(e => e.destroy());
            entities = [];
            trafficPool = [];
            
            // Re-init graphics if needed (resolution settings)
            if(document.getElementById('lowResToggle').checked) renderer.setPixelRatio(0.5);
            else renderer.setPixelRatio(window.devicePixelRatio);
            
            // Build World
            if(type === 'default') {
                createCity(); // The RESTORED function
            } else {
                // Maze logic
                let w=20, h=20;
                if(type === 'medium') {w=40; h=40;}
                if(type === 'large') {w=60; h=60;}
                
                const data = generateMazeData(w,h);
                mapGrid = data.grid;
                roadTiles = data.roads;
                
                // Build Maze Visuals
                const boxGeo = new THREE.BoxGeometry(1,1,1);
                const wallOffX = w * BLOCK_SIZE / 2;
                const wallOffZ = h * BLOCK_SIZE / 2;
                const pg = new THREE.PlaneGeometry(w*BLOCK_SIZE*1.2, h*BLOCK_SIZE*1.2);
                const pm = new THREE.MeshStandardMaterial({ color: 0x222222 });
                const g = new THREE.Mesh(pg, pm);
                g.rotation.x = -Math.PI/2; g.position.y = -0.1;
                scene.add(g);

                for (let z = 0; z < h; z++) {
                    for (let x = 0; x < w; x++) {
                        if (mapGrid[z][x] === '#') {
                            const height = Math.random() * 25 + 5;
                            const mesh = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x444444 }));
                            mesh.scale.set(BLOCK_SIZE, height, BLOCK_SIZE);
                            const wx = (x * BLOCK_SIZE) - wallOffX;
                            const wz = (z * BLOCK_SIZE) - wallOffZ;
                            mesh.position.set(wx, height/2, wz);
                            mesh.castShadow = true; mesh.receiveShadow = true;
                            scene.add(mesh);
                            const body = world.createBody(pl.Vec2(wx, wz));
                            body.createFixture(pl.Box(BLOCK_SIZE/2, BLOCK_SIZE/2), { filterCategoryBits: CAT_WALL });
                        }
                    }
                }
            }

            // Spawn Players
            let sx = 5, sz = 0;
            if(type !== 'default' && roadTiles.length > 0) {
                 const s = roadTiles[Math.floor(roadTiles.length/2)];
                 sx = s.x; sz = s.z;
            }
            
            player1 = new Car(sx, sz, true, 1, loadedTextures[0]);
            player2 = new Car(sx - 10, sz, true, 2, loadedTextures[1]);
            entities.push(player1);
            entities.push(player2);
            
            gameActive = true;
            animate(0);
        });
    };

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
    document.getElementById('newGameButton').onclick = () => location.reload();
    document.getElementById('restartCurrentButton').onclick = () => window.startGameWithMap(currentMapType);

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
            velIter = 2; posIter = 1;
        } else {
            velIter = 8; posIter = 3;
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
    updateSlider('densitySlider', 'trafficCount', 'densityValue');
});
