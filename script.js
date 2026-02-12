document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Constants ---
    const ASSET_FOLDER = 'auto/';
    const MAX_ASSETS = 9; 
    const BLOCK_SIZE = 20; 
    
    // --- Traffic Lane Settings ---
    const LANE_INNER = 2.5; 
    const LANE_OUTER = 6.5; 
    let trafficSpawnCounter = 0;

    // --- Physics Settings (Planck) ---
    const pl = planck;
    const TIME_STEP = 1 / 60;
    
    let velIter = 6; 
    let posIter = 2; 

    // --- State Variables ---
    let isPaused = false;
    let gameActive = false;
    let loadedTextures = [];
    let currentMapType = 'default';
    let physicsMode = 'new'; // 'old' or 'new'
    
    // --- Infinite Highway State ---
    let highwayChunks = [];
    const CHUNK_LENGTH = 400;
    
    let gamepadAssignments = { p1: null, p2: null }; 

    let gameParams = {
        playerSpeed: 300, // Player Speed Scalar
        enemySpeed: 60,   // AI Normal Speed
        trafficCount: 20, 
        spawnRadius: 120,
        simpleMaterials: false, 
        particlesEnabled: true,
        headlightsEnabled: false,
        bulletGlow: false,
        cameraHeight: 60,
        cameraFOV: 50,
        topDownMode: true, 
        cameraRotate: false,
        
        // --- AI Behavior ---
        aiMode: 'cruiser', 

        // --- OLD ARCADE Physics Params ---
        gtaGrip: 0.12,          
        gtaTurnFactor: 8.5,     
        gtaDrag: 0.985,         
        gtaHandbrakeGrip: 0.35 
    };
    
    let p1Score = 0;
    let p2Score = 0;

    // --- DOM Elements ---
    const p1ScoreEl = document.getElementById('p1Score');
    const p2ScoreEl = document.getElementById('p2Score');
    const helpMenu = document.getElementById('helpMenu');
    const customizeMenu = document.getElementById('customizeMenu');
    const optionsMenu = document.getElementById('optionsMenu');
    const optionsHint = document.getElementById('optionsHint');

    // --- THREE.JS Setup ---
    const container = document.getElementById('canvas-container');
    const renderer = new THREE.WebGLRenderer({ antialias: true }); 
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    if (document.getElementById('lowResToggle') && document.getElementById('lowResToggle').checked) {
        renderer.setPixelRatio(0.5);
    } else {
        renderer.setPixelRatio(window.devicePixelRatio);
    }
    
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.fog = new THREE.Fog(0x222222, 50, 160); 

    const camera = new THREE.PerspectiveCamera(gameParams.cameraFOV, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, gameParams.cameraHeight, 30); 
    camera.lookAt(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
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
    const world = pl.World(pl.Vec2(0, 0)); 

    // --- Game Entities ---
    let entities = []; 
    let trafficPool = [];
    let player1, player2;
    let mapGrid = [];
    let roadTiles = []; 
    let roadLookup = {}; 
    let skidMarks = []; // Array to manage tire marks
    let skidTexture = null;
    
    const CAT_PLAYER = 0x0001;
    const CAT_ENEMY = 0x0002;
    const CAT_BULLET = 0x0004;
    const CAT_WALL = 0x0008;

    // --- Asset Loading & Procedural Textures ---
    const textureLoader = new THREE.TextureLoader();
    
    function createProceduralTexture(type) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#444444';
        ctx.fillRect(0, 0, 128, 128);

        if (type === 'road') {
            ctx.fillStyle = '#333333';
            ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = '#eeeeee'; 
            ctx.fillRect(62, 0, 4, 128); 
            ctx.fillRect(0, 62, 128, 4); 
        } else if (type === 'building') {
            ctx.fillStyle = '#999999';
            ctx.fillRect(0,0,128,128);
            ctx.fillStyle = '#ffffaa'; 
            for(let y=10; y<128; y+=32) {
                for(let x=10; x<128; x+=20) {
                    if(Math.random() > 0.3) ctx.fillRect(x, y, 12, 18);
                }
            }
        } else if (type === 'roof') {
            ctx.fillStyle = '#555555'; 
            ctx.fillRect(0, 0, 128, 128);
            ctx.strokeStyle = '#444444';
            ctx.lineWidth = 4;
            ctx.strokeRect(0,0,128,128);
            ctx.fillStyle = '#666666';
            ctx.fillRect(20, 20, 20, 20); 
        } else if (type === 'skid') {
            // Semi-transparent black tire mark
            ctx.clearRect(0,0,128,128);
            ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
            ctx.fillRect(0,0,128,128);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

    function loadAssets() {
        if(loadedTextures.length > 0) return Promise.resolve();
        skidTexture = createProceduralTexture('skid');

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

    // --- Helper Math ---
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function angleDiff(a, b) {
        let d = a - b;
        while (d <= -Math.PI) d += Math.PI * 2;
        while (d > Math.PI) d -= Math.PI * 2;
        return d;
    }

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
                if (Array.isArray(this.mesh.material)) {
                    this.mesh.material.forEach(m => m.dispose());
                } else if(this.mesh.material) {
                    this.mesh.material.dispose();
                }
            }
            if (this.body) world.destroyBody(this.body);
        }
    }

    // --- Skid Mark System ---
    class SkidMark {
        constructor(x, y, angle) {
            const geo = new THREE.PlaneGeometry(0.8, 0.8);
            const mat = new THREE.MeshBasicMaterial({ 
                map: skidTexture, 
                transparent: true, 
                opacity: 0.5, 
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -1 // Draw just above road
            });
            this.mesh = new THREE.Mesh(geo, mat);
            this.mesh.position.set(x, 0.05, y); // Slightly above ground
            this.mesh.rotation.x = -Math.PI / 2;
            this.mesh.rotation.z = angle;
            scene.add(this.mesh);
            this.life = 4.0; // Seconds before fade
        }
        update(dt) {
            this.life -= dt;
            if (this.life < 1.0) {
                this.mesh.material.opacity = this.life * 0.5;
            }
            return this.life > 0;
        }
        destroy() {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
    }

    class Car extends Entity {
        constructor(x, y, isPlayer, playerIndex, texture, plannedAction = 'random', laneOffset = 2.5) {
            const width = 1.8;
            const height = 3.8;
            const geometry = new THREE.PlaneGeometry(width, height);
            
            let material;
            if (gameParams.simpleMaterials) {
                material = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.5 });
            } else {
                material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.5, roughness: 0.5 });
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.rotation.x = -Math.PI / 2; 
            const containerMesh = new THREE.Group(); 
            containerMesh.add(mesh);

            if (gameParams.headlightsEnabled) {
                const leftLight = new THREE.SpotLight(0xffffff, 10, 40, 0.6, 0.5, 1);
                leftLight.position.set(-0.6, 0.5, 1.5); 
                const rightLight = new THREE.SpotLight(0xffffff, 10, 40, 0.6, 0.5, 1);
                rightLight.position.set(0.6, 0.5, 1.5);
                const leftTarget = new THREE.Object3D(); leftTarget.position.set(-0.6, 0, 10);
                leftLight.target = leftTarget;
                const rightTarget = new THREE.Object3D(); rightTarget.position.set(0.6, 0, 10);
                rightLight.target = rightTarget;
                containerMesh.add(leftLight); containerMesh.add(leftTarget);
                containerMesh.add(rightLight); containerMesh.add(rightTarget);
            }

            const body = world.createBody({
                type: 'dynamic',
                position: pl.Vec2(x, y),
                linearDamping: 0.0, 
                angularDamping: 2.0 
            });

            body.setSleepingAllowed(false);

            body.createFixture(pl.Box(width / 2, height / 2), {
                density: 5.0, 
                friction: 0.1, 
                restitution: 0.1,
                filterCategoryBits: isPlayer ? CAT_PLAYER : CAT_ENEMY,
                filterMaskBits: CAT_PLAYER | CAT_ENEMY | CAT_WALL | CAT_BULLET
            });

            super(containerMesh, body);
            this.isPlayer = isPlayer;
            this.playerIndex = playerIndex;
            this.shootCooldown = 0;
            this.maxSpeed = isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;
            this.power = isPlayer ? 900 : 150; 
            
            this.aiTargetAngle = 0;
            this.lastDecisionTile = null;
            this.plannedAction = plannedAction; 
            this.laneOffset = laneOffset; 
            this.stuckTimer = 0; 

            // --- Control Inputs ---
            this.throttleInput = 0;
            this.steerInput = 0;
            this.handbrakeInput = false;

            // --- GTA1 Arcade State ---
            this.speed = 0;
            this.vx = 0;
            this.vy = 0;
        }

        update(dt) {
            super.update();
            if (this.shootCooldown > 0) this.shootCooldown -= dt;
            this.maxSpeed = this.isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;

            if (physicsMode === 'old') {
                this.updatePhysicsOld(dt);
            } else {
                this.updatePhysicsNew(dt);
            }
        }

        drive(throttle, steer, handbrake) {
            this.throttleInput = throttle;
            this.steerInput = steer;
            this.handbrakeInput = handbrake;
        }

        // --- OLD: Direct Velocity Manipulation ---
        updatePhysicsOld(dt) {
            // Drag
            this.speed *= gameParams.gtaDrag;

            // Acceleration
            const accel = this.power * 0.002;
            if (this.throttleInput !== 0) {
                // If handbrake is held, severely reduce acceleration power (engine revving but slipping)
                const slip = this.handbrakeInput ? 0.3 : 1.0;
                this.speed += this.throttleInput * accel * slip;
            }

            // Steering Logic
            if (Math.abs(this.speed) > 0.1) {
                const speedAbs = Math.abs(this.speed);
                const authority = Math.min(1.0, speedAbs / 15.0);
                const maxVelUnit = this.maxSpeed / 3.6;
                const speedFraction = Math.min(1.0, speedAbs / maxVelUnit);
                const dampening = 1.0 - (speedFraction * 0.5); 
                
                // Allow faster spinning if handbrake is on (turn around)
                const handbrakeBonus = this.handbrakeInput ? 2.5 : 1.0;

                const turn = this.steerInput * gameParams.gtaTurnFactor * authority * dampening * 0.006 * handbrakeBonus;
                const dir = this.speed > 0 ? 1 : -1;
                
                this.body.setAngle(this.body.getAngle() - (turn * dir));
            }

            // Calculate Forward Vector
            const angle = this.body.getAngle();
            const fx = -Math.sin(angle); 
            const fy = Math.cos(angle);

            // Determine Target Velocity Vector
            const targetVx = fx * this.speed;
            const targetVy = fy * this.speed;

            // Apply Grip / Drift
            let grip = gameParams.gtaGrip;
            if (this.handbrakeInput) {
                grip *= gameParams.gtaHandbrakeGrip; // Slide more
                // If sliding fast, leave marks
                if (Math.abs(this.speed) > 10) this.spawnSkidMarks();
            }

            this.vx += (targetVx - this.vx) * grip;
            this.vy += (targetVy - this.vy) * grip;

            this.body.setLinearVelocity(pl.Vec2(this.vx, this.vy));
            this.body.setAngularVelocity(this.body.getAngularVelocity() * 0.85); // High angular damping in old mode

            // Speed Cap
            const max = this.maxSpeed / 3.6; 
            this.speed = clamp(this.speed, -max * 0.5, max);
        }

        // --- NEW: Physics-Based Drift Model ---
        updatePhysicsNew(dt) {
            const body = this.body;
            const velocity = body.getLinearVelocity();
            const speed = velocity.length();

            // 1. Get Orientation Vectors
            const angle = body.getAngle();
            const forwardNormal = pl.Vec2(-Math.sin(angle), Math.cos(angle));
            const rightNormal = pl.Vec2(Math.cos(angle), Math.sin(angle));

            // 2. Kill Lateral Velocity (The "Tire Grip" impulse)
            const lateralVel = pl.Vec2.dot(rightNormal, velocity);
            const forwardVel = pl.Vec2.dot(forwardNormal, velocity);
            
            // Grip factor: 1.0 = tracks perfectly, 0.0 = ice.
            let grip = 0.95; // High default grip
            
            // Reduce grip if handbraking
            if (this.handbrakeInput) {
                grip = 0.05; // Drifting/Sliding
            } 
            // Also reduce grip if turning extremely hard at high speed (loss of traction)
            else if (speed > 20 && Math.abs(lateralVel) > 10) {
                 grip = 0.90; 
            }

            const impulse = rightNormal.clone().mul(-lateralVel * grip * body.getMass());
            body.applyLinearImpulse(impulse, body.getWorldCenter());

            // 3. Angular Control (Steering)
            // If handbraking AND moving significantly, allow car to spin freely.
            // If stopped or normal driving, dampen rotation.
            if (this.handbrakeInput && speed > 5.0) {
                body.setAngularDamping(0.5); 
            } else {
                body.setAngularDamping(4.0);
            }

            // Apply steering torque / angular velocity
            if (Math.abs(this.steerInput) > 0.01) {
                // Steer stronger if handbraking to whip the car around
                let steerPower = this.handbrakeInput ? 6.0 : 3.0; 
                
                // --- FIX: Scale steering based on speed when handbraking ---
                if (this.handbrakeInput) {
                    // Map speed 0->10 to factor 0.0->1.0
                    const speedFactor = Math.min(1.0, speed / 10.0);
                    steerPower *= speedFactor;
                }
                
                // Inverse steering direction for reverse?
                let dir = 1;
                if (forwardVel < -5) dir = -1; // Reverse steering
                
                const currentAngVel = body.getAngularVelocity();
                const targetAngVel = -this.steerInput * steerPower * dir;
                
                // Blend
                const angDiff = targetAngVel - currentAngVel;
                body.applyAngularImpulse(angDiff * body.getInertia() * 0.1); 
            }

            // 4. Engine Power (Forward Impulse)
            if (Math.abs(this.throttleInput) > 0.01) {
                let forceMagnitude = this.power * 0.5 * this.throttleInput;
                // If handbrake is on, driving force is reduced (wheels spinning)
                if (this.handbrakeInput) forceMagnitude *= 0.3;

                const force = forwardNormal.clone().mul(forceMagnitude);
                body.applyForce(force, body.getWorldCenter());
            }

            // 5. Linear Drag (Air resistance + Rolling resistance)
            // Add extra drag if moving sideways (scrubbing speed)
            const dragFactor = 0.02 + (Math.abs(lateralVel) * 0.05); 
            // Extra drag on handbrake (brakes locked)
            const brakeDrag = this.handbrakeInput ? 0.05 : 0;
            
            const dragForce = velocity.clone().mul(-(dragFactor + brakeDrag) * body.getMass());
            body.applyForce(dragForce, body.getWorldCenter());

            // 6. Skid Marks Logic
            // If there is significant lateral velocity (sliding), or handbrake is locked
            if ((Math.abs(lateralVel) > 4.0 && speed > 5) || (this.handbrakeInput && speed > 5)) {
                this.spawnSkidMarks();
            }

            // Update internal speed prop for AI logic consistency
            this.speed = forwardVel * 3.6; // approx conversion
        }

        spawnSkidMarks() {
            // Don't spawn every frame, maybe every 3rd frame or based on distance
            if (Math.random() > 0.4) return; 

            const pos = this.body.getPosition();
            const angle = this.body.getAngle();
            const right = { x: Math.cos(angle), y: Math.sin(angle) };
            const fwd = { x: -Math.sin(angle), y: Math.cos(angle) };

            // Offset to rear tires. 
            // Car is approx 3.8 long (center is 0). Back is ~ -1.5. 
            // Width 1.8. Tires ~ +/- 0.6.
            const backOffset = -1.4;
            const widthOffset = 0.65;

            const lX = pos.x + (fwd.x * backOffset) - (right.x * widthOffset);
            const lY = pos.y + (fwd.y * backOffset) - (right.y * widthOffset);
            
            const rX = pos.x + (fwd.x * backOffset) + (right.x * widthOffset);
            const rY = pos.y + (fwd.y * backOffset) + (right.y * widthOffset);

            skidMarks.push(new SkidMark(lX, lY, angle));
            skidMarks.push(new SkidMark(rX, rY, angle));
        }

        // --- UPDATED AI (Kept largely same, just inputs) ---
        aiUpdate(dt) {
            if (this.isPlayer) return;

            const pos = this.body.getPosition();
            const velocity = this.body.getLinearVelocity();
            const physVel = velocity.length();
            
            const tileX = Math.round(pos.x / BLOCK_SIZE) * BLOCK_SIZE;
            const tileZ = Math.round(pos.y / BLOCK_SIZE) * BLOCK_SIZE;
            const tileKey = `${tileX},${tileZ}`;
            
            // --- 1. CRASH RECOVERY ---
            if(physVel < 2.0) {
                this.stuckTimer += dt;
                if(this.stuckTimer > 0.5) {
                    this.drive(-1, 1, false); // Reverse & Turn
                    return;
                }
            } else {
                this.stuckTimer = 0;
            }
            if (this.stuckTimer > 4.0 && currentMapType === 'default') this.markedForDeletion = true;

            // --- 2. NAVIGATION ---
            if (currentMapType !== 'default' && pl.Vec2.distance(pos, pl.Vec2(tileX, tileZ)) < 8.0 && this.lastDecisionTile !== tileKey) {
                this.lastDecisionTile = tileKey;
                this.makeTurnDecision(tileX, tileZ);
            }

            // --- 3. STEERING ---
            const currentAngle = this.body.getAngle();
            const angleToTarget = angleDiff(this.aiTargetAngle, currentAngle);
            let steer = 0;
            let throttle = 0;
            let brake = false;

            if (Math.abs(angleToTarget) > 0.1) {
                steer = angleToTarget > 0 ? -1 : 1; // Inverted steering model from input
                throttle = 0.5; // Slow down
            } else {
                steer = angleToTarget * -2.0; // P-controller
                throttle = 1.0;
            }

            // Speed Limit
            const maxVel = this.maxSpeed / 3.6;
            if (physVel > maxVel) throttle = 0;

            this.drive(throttle, clamp(steer, -1, 1), brake);
        }

        makeTurnDecision(cx, cz) {
            const neighbors = [
                { dir: 0, x: cx, z: cz - BLOCK_SIZE, angle: 0 },         
                { dir: 1, x: cx + BLOCK_SIZE, z: cz, angle: -Math.PI/2 },
                { dir: 2, x: cx, z: cz + BLOCK_SIZE, angle: Math.PI },   
                { dir: 3, x: cx - BLOCK_SIZE, z: cz, angle: Math.PI/2 }  
            ];
            const valid = neighbors.filter(n => roadLookup[`${n.x},${n.z}`]);
            if (valid.length === 0) return; 

            const getRel = (target) => angleDiff(target, this.aiTargetAngle);
            const straight = valid.find(n => Math.abs(getRel(n.angle)) < 0.1);
            const left     = valid.find(n => Math.abs(getRel(n.angle) - Math.PI/2) < 0.1); 
            const right    = valid.find(n => Math.abs(getRel(n.angle) + Math.PI/2) < 0.1);

            let selected = null;
            if (this.plannedAction === 'left' && left) selected = left;
            else if (this.plannedAction === 'right' && right) selected = right;
            else if (straight) selected = straight;
            else selected = left || right;

            if (!selected && valid.length > 0) selected = valid[Math.floor(Math.random()*valid.length)];
            
            if(selected) {
                this.aiTargetAngle = selected.angle;
                if (this.plannedAction === 'left') this.plannedAction = (Math.random() < 0.3) ? 'left' : 'straight';
                else if (this.plannedAction === 'right') this.plannedAction = (Math.random() < 0.6) ? 'right' : 'straight';
            }
        }

        shoot() {
            if (this.shootCooldown > 0) return;
            const pos = this.body.getPosition();
            const angle = this.body.getAngle();
            const fwd = { x: -Math.sin(angle), y: Math.cos(angle) };
            const right = { x: Math.cos(angle), y: Math.sin(angle) };
            
            const gunOffset = 0.6; 
            const spawnDist = 3.0; 
            const speed = 60;
            
            createBullet(pos.x + fwd.x*spawnDist - right.x*gunOffset, pos.y + fwd.y*spawnDist - right.y*gunOffset, fwd.x*speed, fwd.y*speed, this.playerIndex);
            createBullet(pos.x + fwd.x*spawnDist + right.x*gunOffset, pos.y + fwd.y*spawnDist + right.y*gunOffset, fwd.x*speed, fwd.y*speed, this.playerIndex);
            this.shootCooldown = 0.2;
        }
    }

    function createBullet(x, y, vx, vy, ownerIndex) {
        const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const mesh = new THREE.Mesh(geo, mat);
        if (gameParams.bulletGlow) {
            const light = new THREE.PointLight(0xffaa00, 5, 15);
            mesh.add(light);
        }
        const body = world.createBody({ type: 'dynamic', position: pl.Vec2(x, y), bullet: true });
        body.createFixture(pl.Circle(0.15), { filterCategoryBits: CAT_BULLET, filterMaskBits: CAT_ENEMY | CAT_WALL });
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
        if (!gameParams.particlesEnabled) return; 
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

    // --- INFINITE HIGHWAY LOGIC ---
    function createHighwayChunk(zStart) {
        const chunk = { zStart: zStart, meshes: [], bodies: [], roadData: [] };
        const matType = gameParams.simpleMaterials ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;

        // Ground
        const planeGeo = new THREE.PlaneGeometry(400, CHUNK_LENGTH);
        const roadTex = createProceduralTexture('road');
        roadTex.repeat.set(40, CHUNK_LENGTH/10);
        const planeMat = new matType({ map: roadTex, side: THREE.DoubleSide });
        const ground = new THREE.Mesh(planeGeo, planeMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(0, -0.1, zStart + CHUNK_LENGTH/2);
        ground.receiveShadow = true;
        scene.add(ground);
        chunk.meshes.push(ground);

        const addWall = (x, z, w, h) => {
            const body = world.createBody(pl.Vec2(x, z));
            body.createFixture(pl.Box(w/2, h/2), { filterCategoryBits: CAT_WALL });
            chunk.bodies.push(body);
        };
        addWall(-40, zStart + CHUNK_LENGTH/2, 2, CHUNK_LENGTH);
        addWall(40, zStart + CHUNK_LENGTH/2, 2, CHUNK_LENGTH);

        const boxGeo = new THREE.BoxGeometry(1,1,1);
        const addBuilding = (x, z) => {
            const h = Math.random() * 15 + 5;
            const w = Math.random() * 8 + 6;
            const buildTex = createProceduralTexture('building');
            buildTex.repeat.set(w/10, h/10);
            const roofTex = createProceduralTexture('roof');
            roofTex.repeat.set(w/10, w/10);
            const sideMat = new matType({ map: buildTex, roughness: 0.2 });
            const roofMat = new matType({ map: roofTex, roughness: 0.5 });
            const materials = [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat];
            const bMesh = new THREE.Mesh(boxGeo, materials);
            bMesh.position.set(x, h/2, z);
            bMesh.scale.set(w, h, w);
            bMesh.castShadow = true; bMesh.receiveShadow = true;
            scene.add(bMesh);
            chunk.meshes.push(bMesh);
            const body = world.createBody(pl.Vec2(x, z));
            body.createFixture(pl.Box(w/2, w/2), { filterCategoryBits: CAT_WALL });
            chunk.bodies.push(body);
        };

        for(let z = zStart; z < zStart + CHUNK_LENGTH; z += 12) {
            addBuilding(-35, z); addBuilding(35, z);
        }

        // AI Nodes
        for(let z = zStart; z < zStart + CHUNK_LENGTH; z += 20) {
            const t1={x: -15, z: z}, t2={x: 0, z: z}, t3={x: 15, z: z};
            roadTiles.push(t1, t2, t3);
            roadLookup[`${t1.x},${t1.z}`]=true; chunk.roadData.push(t1);
            roadLookup[`${t2.x},${t2.z}`]=true; chunk.roadData.push(t2);
            roadLookup[`${t3.x},${t3.z}`]=true; chunk.roadData.push(t3);
        }
        highwayChunks.push(chunk);
    }

    function createCity() {
        highwayChunks = [];
        roadTiles = [];
        roadLookup = {};
        createHighwayChunk(-CHUNK_LENGTH); 
        createHighwayChunk(0);             
        createHighwayChunk(CHUNK_LENGTH);  
    }

    function updateHighway() {
        if (currentMapType !== 'default' || !player1) return;
        const pZ = player1.body.getPosition().y; 
        const currentChunkIdx = Math.floor(pZ / CHUNK_LENGTH);
        [-1, 0, 1].forEach(offset => {
            const targetIdx = currentChunkIdx + offset;
            const targetZ = targetIdx * CHUNK_LENGTH;
            const exists = highwayChunks.some(c => Math.abs(c.zStart - targetZ) < 1);
            if (!exists) createHighwayChunk(targetZ);
        });

        for (let i = highwayChunks.length - 1; i >= 0; i--) {
            const chunk = highwayChunks[i];
            const chunkIdx = Math.round(chunk.zStart / CHUNK_LENGTH);
            if (Math.abs(chunkIdx - currentChunkIdx) > 2) {
                chunk.meshes.forEach(m => { 
                    scene.remove(m); 
                    if(m.geometry) m.geometry.dispose();
                    if(Array.isArray(m.material)) m.material.forEach(mat=>mat.dispose());
                    else if(m.material) m.material.dispose();
                });
                chunk.bodies.forEach(b => world.destroyBody(b));
                chunk.roadData.forEach(t => delete roadLookup[`${t.x},${t.z}`]);
                roadTiles = roadTiles.filter(t => !chunk.roadData.includes(t));
                highwayChunks.splice(i, 1);
            }
        }
    }
    
    function generateMazeData(width, height) {
        let grid = [];
        let roads = [];
        for (let z = 0; z < height; z++) {
            let row = [];
            for (let x = 0; x < width; x++) {
                if (x === 0 || x === width - 1 || z === 0 || z === height - 1) {
                    row.push('#'); continue;
                }
                const modX = (x - 1) % 6; const modZ = (z - 1) % 4;
                if (modX < 5 && modZ < 3) row.push('#'); else row.push(' '); 
            }
            grid.push(row);
        }
        for(let z=0; z<height; z++) {
            for(let x=0; x<width; x++) {
                if(grid[z][x] === ' ') {
                    roads.push({ x: (x * BLOCK_SIZE) - (width * BLOCK_SIZE / 2), z: (z * BLOCK_SIZE) - (height * BLOCK_SIZE / 2) });
                }
            }
        }
        return { grid, roads };
    }

    function buildRoadLookup() {
        roadLookup = {};
        roadTiles.forEach(t => { roadLookup[`${t.x},${t.z}`] = true; });
    }

    function spawnTraffic() {
        if (loadedTextures.length === 0 || !player1) return;
        const pPos = player1.body.getPosition();
        const pAngle = player1.body.getAngle();
        const pDir = pl.Vec2(-Math.sin(pAngle), Math.cos(pAngle));
        const spawnRadius = gameParams.spawnRadius;

        for(let i = trafficPool.length - 1; i >= 0; i--) {
            if (pl.Vec2.distance(trafficPool[i].body.getPosition(), pPos) > spawnRadius) {
                trafficPool[i].markedForDeletion = true; 
            }
        }

        if (trafficPool.length < gameParams.trafficCount) {
             const tex = loadedTextures[Math.floor(Math.random() * loadedTextures.length)];
             let validTile = null, attempts = 0;
             while(!validTile && attempts < 15) {
                 const tile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
                 const tileVec = pl.Vec2(tile.x, tile.z);
                 const toTile = pl.Vec2.sub(tileVec, pPos);
                 if (toTile.length() > spawnRadius - 45 && toTile.length() < spawnRadius - 5 && pl.Vec2.dot(toTile, pDir) > -30) {
                     if(!trafficPool.some(c => pl.Vec2.distance(c.body.getPosition(), tileVec) < 15)) validTile = tile;
                 }
                 attempts++;
             }
             if (!validTile) return; 

             let x = validTile.x, z = validTile.z, angle = 0;
             if (currentMapType === 'default') {
                 trafficSpawnCounter++;
                 const lane = trafficSpawnCounter % 4;
                 x = (lane === 0) ? 2.5 : (lane === 1) ? 6.5 : (lane === 2) ? -2.5 : -6.5;
                 angle = x > 0 ? 0 : Math.PI;
             } else {
                 angle = (Math.random() > 0.5) ? 0 : Math.PI/2;
             }

             const car = new Car(x, z, false, 0, tex, 'straight', 0);
             car.body.setAngle(angle);
             car.aiTargetAngle = angle;
             entities.push(car);
             trafficPool.push(car);
        }
    }

    world.on('begin-contact', (contact) => {
        const a = contact.getFixtureA().getBody();
        const b = contact.getFixtureB().getBody();
        const entA = entities.find(e => e.body === a);
        const entB = entities.find(e => e.body === b);
        if(!entA || !entB) return;

        // Bounce Logic
        if (entA instanceof Car || entB instanceof Car) {
            const car = entA instanceof Car ? entA : entB;
            car.speed *= 0.3; // Old physics speed prop
            // New physics naturally handles bounce via restitution
        }

        if(entA.isBullet || entB.isBullet) {
            const bullet = entA.isBullet ? entA : entB;
            const target = entA.isBullet ? entB : entA;
            if(target instanceof Car && !target.isPlayer) {
                bullet.markedForDeletion = true;
                target.markedForDeletion = true; 
                if(bullet.owner === 1) p1Score += 100; else p2Score += 100;
                createExplosion(target.mesh.position);
                p1ScoreEl.innerText = `P1: ${p1Score}`; p2ScoreEl.innerText = `P2: ${p2Score}`;
            } else if (!target.isPlayer) {
                bullet.markedForDeletion = true; 
            }
        }
    });

    const keys = {};
    window.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
    window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

    let lastTime = 0;
    function animate(time) {
        requestAnimationFrame(animate);
        const dt = Math.min((time - lastTime) / 1000, 0.05);
        lastTime = time;

        if (!gameActive || isPaused) return;

        if (Math.random() < 0.1) spawnTraffic();
        updateHighway();
        world.step(TIME_STEP, velIter, posIter);

        // --- SKID MARKS UPDATE ---
        for (let i = skidMarks.length - 1; i >= 0; i--) {
            if (!skidMarks[i].update(dt)) {
                skidMarks[i].destroy();
                skidMarks.splice(i, 1);
            }
        }

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < gamepads.length; i++) {
            const gp = gamepads[i];
            if (gp && gp.buttons.some((b, idx) => idx < 4 && b.pressed)) {
                if (gamepadAssignments.p1 === null && gamepadAssignments.p2 !== gp.index) gamepadAssignments.p1 = gp.index;
                else if (gamepadAssignments.p2 === null && gamepadAssignments.p1 !== gp.index) gamepadAssignments.p2 = gp.index;
            }
        }

        if (player1) {
            let throttle = 0, steer = 0, shoot = false, handbrake = false;
            if (keys['arrowup']) throttle = 1; if (keys['arrowdown']) throttle = -1;
            if (keys['arrowleft']) steer = 1; if (keys['arrowright']) steer = -1; 
            if (keys['control']) shoot = true; 
            if (keys[' '] || keys['shift']) handbrake = true;

            if (gamepadAssignments.p1 !== null && gamepads[gamepadAssignments.p1]) {
                const gp = gamepads[gamepadAssignments.p1];
                if (Math.abs(gp.axes[0]) > 0.2) steer = -gp.axes[0]; 
                if (gp.buttons[0]?.pressed || gp.buttons[12]?.pressed) throttle = 1;
                if (gp.buttons[13]?.pressed || gp.axes[1] > 0.5) throttle = -1;
                if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) shoot = true;
                if (gp.buttons[4]?.pressed || gp.buttons[5]?.pressed) handbrake = true;
            }
            player1.drive(throttle, steer, handbrake);
            if (shoot) player1.shoot();
        }

        if (player2) {
            let throttle = 0, steer = 0, shoot = false, handbrake = false;
            if (keys['w']) throttle = 1; if (keys['s']) throttle = -1;
            if (keys['a']) steer = 1; if (keys['d']) steer = -1; 
            if (keys['f']) shoot = true;
            if (keys[' ']) handbrake = true; 
            
            if (gamepadAssignments.p2 !== null && gamepads[gamepadAssignments.p2]) {
                const gp = gamepads[gamepadAssignments.p2];
                if (Math.abs(gp.axes[0]) > 0.2) steer = -gp.axes[0]; 
                if (gp.buttons[0]?.pressed) throttle = 1;
                if (gp.buttons[1]?.pressed) shoot = true;
            }
            player2.drive(throttle, steer, handbrake);
            if (shoot) player2.shoot();
        }

        trafficPool.forEach(car => {
            if(!car.markedForDeletion) {
                car.update(dt);
                car.aiUpdate(dt);
            }
        });

        // Entity Cleanup
        for (let i = entities.length - 1; i >= 0; i--) {
             if (entities[i] === player1 || entities[i] === player2) {
                 entities[i].update(dt);
                 continue;
             }
             entities[i].update(dt);
             if (entities[i].markedForDeletion) {
                 entities[i].destroy();
                 entities.splice(i, 1);
                 const idx = trafficPool.indexOf(entities[i]);
                 if(idx > -1) trafficPool.splice(idx, 1);
             }
        }

        // Camera
        if (player1 && player1.mesh) {
            if(camera.fov !== gameParams.cameraFOV) { camera.fov = gameParams.cameraFOV; camera.updateProjectionMatrix(); }
            const targetX = player1.mesh.position.x;
            const distH = gameParams.topDownMode ? 0.1 : 20; 
            let finalCamX = targetX, finalCamZ = player1.mesh.position.z + distH;
            
            if (gameParams.cameraRotate) {
                 const angle = player1.body.getAngle(); 
                 finalCamX = targetX + (-Math.sin(angle) * distH);
                 finalCamZ = player1.mesh.position.z + (Math.cos(angle) * distH);
                 if(gameParams.topDownMode) camera.up.set(Math.sin(angle), 0, Math.cos(angle));
                 else camera.up.set(0,1,0);
            } else {
                 if(gameParams.topDownMode) camera.up.set(0,0,-1);
                 else camera.up.set(0,1,0);
            }
            camera.position.x += (finalCamX - camera.position.x) * 0.1;
            camera.position.z += (finalCamZ - camera.position.z) * 0.1;
            camera.position.y += (gameParams.cameraHeight - camera.position.y) * 0.1;
            camera.lookAt(targetX, 0, player1.mesh.position.z);
            
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
        document.getElementById('optionsHint').classList.remove('hidden');
        isPaused = false;
        
        loadAssets().then(() => {
            entities.forEach(e => e.destroy());
            skidMarks.forEach(s => s.destroy());
            entities = []; trafficPool = []; skidMarks = [];
            
            if(type === 'default') createCity(); 
            else {
                let w=20, h=20;
                if(type === 'medium') {w=40; h=40;}
                if(type === 'large') {w=60; h=60;}
                const data = generateMazeData(w,h);
                mapGrid = data.grid; roadTiles = data.roads;
                buildRoadLookup();

                const pg = new THREE.PlaneGeometry(w*BLOCK_SIZE*1.2, h*BLOCK_SIZE*1.2);
                const roadTex = createProceduralTexture('road');
                roadTex.repeat.set(w, h);
                const pm = gameParams.simpleMaterials ? new THREE.MeshLambertMaterial({map: roadTex}) : new THREE.MeshStandardMaterial({map: roadTex});
                const g = new THREE.Mesh(pg, pm);
                g.rotation.x = -Math.PI/2; g.position.y = -0.1;
                scene.add(g);

                const boxGeo = new THREE.BoxGeometry(1,1,1);
                const wallOffX = w * BLOCK_SIZE / 2, wallOffZ = h * BLOCK_SIZE / 2;
                for (let z = 0; z < h; z++) {
                    for (let x = 0; x < w; x++) {
                        if (mapGrid[z][x] === '#') {
                            const height = Math.random() * 25 + 5;
                            const buildTex = createProceduralTexture('building');
                            buildTex.repeat.set(BLOCK_SIZE/10, height/10);
                            const roofTex = createProceduralTexture('roof');
                            const sideMat = new (gameParams.simpleMaterials ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial)({map: buildTex});
                            const roofMat = new (gameParams.simpleMaterials ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial)({map: roofTex});
                            const materials = [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat];
                            const mesh = new THREE.Mesh(boxGeo, materials);
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

            let sx = 5, sz = 0;
            if(type !== 'default' && roadTiles.length > 0) {
                 const s = roadTiles[Math.floor(roadTiles.length/2)];
                 sx = s.x; sz = s.z;
            }
            player1 = new Car(sx, sz, true, 1, loadedTextures[0]);
            player2 = new Car(sx - 10, sz, true, 2, loadedTextures[1]);
            entities.push(player1); entities.push(player2);
            gameActive = true; animate(0);
        });
    };

    function toggleMenu(menu) {
        const isHidden = menu.classList.contains('hidden');
        helpMenu.classList.add('hidden');
        customizeMenu.classList.add('hidden');
        optionsMenu.classList.add('hidden');
        if (isHidden) { menu.classList.remove('hidden'); isPaused = true; } 
        else { isPaused = false; }
    }

    // --- Menus & Inputs ---
    document.getElementById('customizeButton').onclick = () => toggleMenu(customizeMenu);
    document.getElementById('helpButton').onclick = () => toggleMenu(helpMenu);
    document.querySelector('.close-help').onclick = () => toggleMenu(helpMenu);
    document.querySelector('.close-customize').onclick = () => toggleMenu(customizeMenu);
    document.querySelector('.close-options').onclick = () => toggleMenu(optionsMenu);
    document.getElementById('newGameButton').onclick = () => location.reload();
    document.getElementById('restartCurrentButton').onclick = () => window.startGameWithMap(currentMapType);
    
    // Physics Toggles
    const btnOld = document.getElementById('physOldBtn');
    const btnNew = document.getElementById('physNewBtn');
    const txtInfo = document.getElementById('physInfoText');
    
    btnOld.onclick = () => {
        physicsMode = 'old';
        btnOld.classList.add('active'); btnNew.classList.remove('active');
        txtInfo.innerText = "Old: Classic Arcade. Sticky turns, tap to steer.";
    };
    btnNew.onclick = () => {
        physicsMode = 'new';
        btnNew.classList.add('active'); btnOld.classList.remove('active');
        txtInfo.innerHTML = "New: Drifting, tire marks, spin-outs.<br>Spacebar to Handbrake.";
    };

    window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        if (e.key.toLowerCase() === 'c') toggleMenu(customizeMenu);
        if (e.key.toLowerCase() === 'h') toggleMenu(helpMenu);
        if (e.key.toLowerCase() === 'o') toggleMenu(optionsMenu);
    });

    document.getElementById('shadowsToggle').onchange = (e) => {
        dirLight.castShadow = e.target.checked;
        renderer.shadowMap.autoUpdate = e.target.checked;
        if(!e.target.checked) renderer.clearTarget(dirLight.shadow.map);
    };
    document.getElementById('headlightsToggle').onchange = (e) => gameParams.headlightsEnabled = e.target.checked;
    document.getElementById('lowResToggle').onchange = (e) => renderer.setPixelRatio(e.target.checked ? 0.5 : window.devicePixelRatio);
    document.getElementById('litePhysicsToggle').onchange = (e) => { velIter = e.target.checked ? 2 : 8; posIter = e.target.checked ? 1 : 3; };
    document.getElementById('simpleMatToggle').onchange = (e) => gameParams.simpleMaterials = e.target.checked;
    document.getElementById('particlesToggle').onchange = (e) => gameParams.particlesEnabled = e.target.checked;
    document.getElementById('topDownToggle').onchange = (e) => gameParams.topDownMode = e.target.checked;
    document.getElementById('camRotateToggle').onchange = (e) => gameParams.cameraRotate = e.target.checked;
    document.getElementById('camHeightSlider').oninput = (e) => { gameParams.cameraHeight = parseInt(e.target.value); document.getElementById('camHeightValue').innerText = e.target.value; };
    document.getElementById('fovSlider').oninput = (e) => { gameParams.cameraFOV = parseInt(e.target.value); document.getElementById('fovValue').innerText = e.target.value; };
    document.getElementById('aiModeSelect').onchange = (e) => gameParams.aiMode = e.target.value;
    
    const updateSlider = (id, paramKey, displayId) => {
        const el = document.getElementById(id);
        if(el) el.oninput = (e) => { gameParams[paramKey] = parseInt(e.target.value); document.getElementById(displayId).innerText = parseInt(e.target.value); };
    };
    updateSlider('playerSpeedSlider', 'playerSpeed', 'playerSpeedValue');
    updateSlider('enemySpeedSlider', 'enemySpeed', 'enemySpeedValue');
    updateSlider('densitySlider', 'trafficCount', 'densityValue');
});
