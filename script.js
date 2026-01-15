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
    
    // --- Infinite Highway State ---
    let highwayChunks = [];
    const CHUNK_LENGTH = 400;
    
    let gamepadAssignments = { p1: null, p2: null }; 

    let gameParams = {
        playerSpeed: 300, // Player Speed (3x)
        enemySpeed: 60,   // AI Normal Speed
        turnSpeed: 2.5,  
        drift: 0.85,
        trafficCount: 20, 
        spawnRadius: 120,
        simpleMaterials: false, 
        particlesEnabled: true,
        headlightsEnabled: false,
        bulletGlow: false,
        cameraHeight: 60,
        cameraFOV: 50,
        topDownMode: false,
        cameraRotate: false,
        
        // --- AI Behavior ---
        aiMode: 'cruiser', // Default AI Personality

        // --- GTA1 Arcade Physics Params ---
        gtaGrip: 0.12,          // Lower = more ice/drift. 0.12 is snappy but allows slide.
        gtaTurnFactor: 8.5,     // Steering strength
        gtaDrag: 0.985,         // Rolling resistance
        gtaHandbrakeGrip: 0.35  // Grip multiplier when handbraking
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
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    }

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

    function getLateralVelocity(body) {
        const currentRightNormal = body.getWorldVector(pl.Vec2(1, 0));
        const velocity = body.getLinearVelocity();
        const lateralMag = pl.Vec2.dot(currentRightNormal, velocity);
        return currentRightNormal.mul(lateralMag);
    }

    // --- Helpers ---
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
            }
            if (this.body) world.destroyBody(this.body);
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
                linearDamping: 0.0, // Managed manually now
                angularDamping: 2.0 
            });

            // Prevent cars from sleeping if they stop moving
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
            this.power = isPlayer ? 300 : 150; // Player: 3x Acceleration. Enemy: Normal.
            
            this.aiTargetAngle = 0;
            this.lastDecisionTile = null;
            this.plannedAction = plannedAction; 
            this.laneOffset = laneOffset; 
            this.aiCounter = 0; 
            this.stuckTimer = 0; 
            this.resetTimer = 0; 

            // --- GTA1 Physics State ---
            this.speed = 0;
            this.vx = 0;
            this.vy = 0;
            this.handbrake = false;
        }

        update(dt) {
            super.update();
            if (this.shootCooldown > 0) this.shootCooldown -= dt;
            
            this.maxSpeed = this.isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;
            
            // --- GTA1 DRAG ---
            this.speed *= gameParams.gtaDrag;

            // --- FORWARD VECTOR ---
            const angle = this.body.getAngle();
            const fx = -Math.sin(angle); 
            const fy = Math.cos(angle);

            // --- TARGET VELOCITY ---
            const targetVx = fx * this.speed;
            const targetVy = fy * this.speed;

            // --- GRIP / DRIFT ---
            let grip = gameParams.gtaGrip;
            if (this.handbrake) grip *= gameParams.gtaHandbrakeGrip;

            this.vx += (targetVx - this.vx) * grip;
            this.vy += (targetVy - this.vy) * grip;

            // --- APPLY TO PLANCK ---
            this.body.setLinearVelocity(pl.Vec2(this.vx, this.vy));

            // --- KILL ANGULAR DRIFT ---
            this.body.setAngularVelocity(
                this.body.getAngularVelocity() * 0.85
            );

            // --- SPEED CAP ---
            const max = this.maxSpeed / 3.6; // convert km/h roughly to units
            this.speed = clamp(this.speed, -max * 0.5, max);
        }

        // --- UPDATED AI UPDATE METHOD WITH SWAPPABLE ALGORITHMS ---
        aiUpdate(dt) {
            if (this.isPlayer) return;

            const pos = this.body.getPosition();
            const physVel = this.body.getLinearVelocity().length();
            const tileX = Math.round(pos.x / BLOCK_SIZE) * BLOCK_SIZE;
            const tileZ = Math.round(pos.y / BLOCK_SIZE) * BLOCK_SIZE;
            const tileKey = `${tileX},${tileZ}`;
            const distToCenter = pl.Vec2.distance(pos, pl.Vec2(tileX, tileZ));
            
            // --- 1. CRASH RECOVERY (Common to all) ---
            if(physVel < 2.0) {
                this.stuckTimer += dt;
                if(this.stuckTimer > 0.5) {
                    this.speed = 20; 
                    const curAngle = this.body.getAngle();
                    // Force turn if stuck
                    this.body.setAngularVelocity(2.0);
                    // Force reverse if really stuck
                    if(this.stuckTimer > 2.0) this.speed = -10;
                }
            } else {
                this.stuckTimer = 0;
            }
            if (this.stuckTimer > 4.0 && currentMapType === 'default') this.markedForDeletion = true;

            // --- 2. NAVIGATION DECISIONS ---
            if (currentMapType !== 'default' && distToCenter < 8.0 && this.lastDecisionTile !== tileKey) {
                this.lastDecisionTile = tileKey;
                this.makeTurnDecision(tileX, tileZ);
            }

            // --- 3. ALGORITHM SELECTION ---
            let targetSpeed = this.maxSpeed / 3.6;
            let steerFactor = 1.0;
            let laneBias = 0; // Offset from center of lane
            let laneChangeSpeed = 1.0;

            const mode = gameParams.aiMode;

            // --- ALGORITHM 1: CRUISER (Default) ---
            if (mode === 'cruiser') {
                // Standard behavior: steady speed, stays in center of lane
                targetSpeed *= 1.0; 
            }

            // --- ALGORITHM 2: AGGRESSIVE (Mad Max) ---
            else if (mode === 'aggressive') {
                targetSpeed *= 1.4; // Faster
                steerFactor = 2.0;  // Jerky steering
                
                // If player is ahead, try to ram or match X
                if (player1) {
                    const pPos = player1.body.getPosition();
                    const dist = pPos.y - pos.y; // Assuming driving North/South
                    // If player is within 60 units ahead
                    if (Math.abs(dist) < 60) {
                        // Steer towards player X
                        const diffX = pPos.x - pos.x;
                        laneBias = diffX; // Try to occupy player's lane
                        laneChangeSpeed = 5.0; // Aggressive lane change
                    }
                }
            }

            // --- ALGORITHM 3: CAUTIOUS (Grandma) ---
            else if (mode === 'cautious') {
                targetSpeed *= 0.6; // Slow
                steerFactor = 0.5;  // Gentle turns
                
                // Avoid player at all costs
                if (player1) {
                    const pPos = player1.body.getPosition();
                    if (pl.Vec2.distance(pos, pPos) < 40) {
                        targetSpeed *= 0.5; // Brake hard if player near
                        // Stick to outer edge (simple avoidance)
                        laneBias = (pos.x > 0) ? 5 : -5; 
                    }
                }
            }

            // --- ALGORITHM 4: ERRATIC (Drunk) ---
            else if (mode === 'erratic') {
                // Speed waves
                const time = Date.now() / 1000;
                targetSpeed *= (0.8 + Math.sin(time * 2) * 0.4); 
                
                // Weave back and forth
                laneBias = Math.sin(time * 3) * 3.0; 
                
                // Random twitching
                if (Math.random() < 0.02) {
                    this.body.setAngularVelocity((Math.random() - 0.5) * 5);
                }
            }

            // --- ALGORITHM 5: RACER (Speed) ---
            else if (mode === 'racer') {
                targetSpeed *= 1.8; // Very fast
                laneChangeSpeed = 3.0;
                
                // Corner cutting logic (simple version)
                // If turning left, enter form right, exit right (Apexing)
                const angleDiffVal = angleDiff(this.aiTargetAngle, this.body.getAngle());
                if (Math.abs(angleDiffVal) > 0.5) {
                    // Slow less for corners
                     targetSpeed *= 0.8; 
                } else {
                    // Overtake logic: If blocked by another car, switch lane
                    // (Simplified: just weave constantly to find gaps)
                    const time = Date.now() / 500;
                    laneBias = Math.sin(time) * 2.0; 
                }
            }

            // --- 4. PHYSICS APPLICATION ---
            const currentAngle = this.body.getAngle();
            const angleToTarget = angleDiff(this.aiTargetAngle, currentAngle);

            // Steering
            if (Math.abs(angleToTarget) > 0.1) {
                const turnRate = 3.0 * steerFactor * dt;
                const turnAmt = clamp(angleToTarget, -turnRate, turnRate);
                this.body.setAngle(currentAngle + turnAmt);
                this.speed = targetSpeed * 0.6; // Slow down in turns
            } else {
                // Straightening & Lane Correction
                this.body.setAngle(currentAngle + angleToTarget * 0.1);
                
                // Lane Logic (Only applies on Highway/Default map mostly)
                if (physVel > 5.0 && distToCenter > 4.0 && currentMapType === 'default') {
                    let idealX = tileX;
                    const cosA = Math.cos(this.aiTargetAngle);
                    
                    // Determine base lane
                    if (Math.abs(cosA) > 0.5) { // Vertical driving
                         if (pos.x > 0) idealX = 4.5 + (pos.x > 4.5 ? 2 : -2); 
                         else idealX = -4.5 + (pos.x < -4.5 ? -2 : 2);
                    }
                    
                    // Apply Algorithm Bias
                    idealX += laneBias;

                    // Apply Correction
                    const diffX = idealX - pos.x;
                    if (Math.abs(diffX) > 0.2) {
                        this.vx += diffX * laneChangeSpeed * dt; 
                    }
                }
                this.speed = targetSpeed;
            }
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

            if (!selected) {
                const nonU = valid.filter(n => Math.abs(getRel(n.angle) - Math.PI) > 0.1);
                if(nonU.length > 0) selected = nonU[Math.floor(Math.random()*nonU.length)];
                else selected = valid[0];
            }
            this.aiTargetAngle = selected.angle;

            if (this.plannedAction === 'left') {
                 this.plannedAction = (Math.random() < 0.3) ? 'left' : 'straight';
            } else if (this.plannedAction === 'right') {
                 this.plannedAction = (Math.random() < 0.6) ? 'right' : 'straight';
            }
        }

        drive(throttle, steer) {
            // --- HAND BRAKE STATE ---
            this.handbrake = keys[' '] || keys['shift'];

            // --- ACCELERATION ---
            const accel = this.power * 0.002;
            if (throttle !== 0) {
                this.speed += throttle * accel;
            }

            // --- TURNING (Speed Dependent) ---
            if (Math.abs(this.speed) > 0.1) {
                const maxVelUnit = this.maxSpeed / 3.6;
                const ratio = Math.abs(this.speed) / maxVelUnit;
                
                const turn = steer * gameParams.gtaTurnFactor * ratio * 0.02;

                const dir = this.speed > 0 ? 1 : -1;
                
                this.body.setAngle(
                    this.body.getAngle() - (turn * dir)
                );
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
            
            createBullet(
                pos.x + fwd.x*spawnDist - right.x*gunOffset, 
                pos.y + fwd.y*spawnDist - right.y*gunOffset, 
                fwd.x*speed, fwd.y*speed, 
                this.playerIndex
            );
            createBullet(
                pos.x + fwd.x*spawnDist + right.x*gunOffset, 
                pos.y + fwd.y*spawnDist + right.y*gunOffset, 
                fwd.x*speed, fwd.y*speed, 
                this.playerIndex
            );
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

    function buildRoadLookup() {
        roadLookup = {};
        roadTiles.forEach(t => {
            roadLookup[`${t.x},${t.z}`] = true;
        });
    }

    // --- INFINITE HIGHWAY LOGIC (Bi-Directional) ---
    function createHighwayChunk(zStart) {
        const chunk = { zStart: zStart, meshes: [], bodies: [], roadData: [] };
        const matType = gameParams.simpleMaterials ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;

        // Ground Plane
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

        // Helper to track walls
        const addWall = (x, z, w, h) => {
            const body = world.createBody(pl.Vec2(x, z));
            body.createFixture(pl.Box(w/2, h/2), { filterCategoryBits: CAT_WALL });
            chunk.bodies.push(body);
        };
        addWall(-40, zStart + CHUNK_LENGTH/2, 2, CHUNK_LENGTH);
        addWall(40, zStart + CHUNK_LENGTH/2, 2, CHUNK_LENGTH);

        // Buildings/Scenery
        const boxGeo = new THREE.BoxGeometry(1,1,1);
        const addBuilding = (x, z) => {
            const h = Math.random() * 15 + 5;
            const w = Math.random() * 8 + 6;
            const buildTex = createProceduralTexture('building');
            buildTex.repeat.set(w/10, h/10);
            
            const bMat = gameParams.simpleMaterials ? new THREE.MeshLambertMaterial({ map: buildTex }) : new THREE.MeshStandardMaterial({ map: buildTex, roughness: 0.2 });
            const bMesh = new THREE.Mesh(boxGeo, bMat);

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

        // Road Tiles for AI
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
        // Initialize infinite highway: Create center, behind, and ahead
        highwayChunks = [];
        roadTiles = [];
        roadLookup = {};
        
        createHighwayChunk(-CHUNK_LENGTH); // Behind (North)
        createHighwayChunk(0);             // Center
        createHighwayChunk(CHUNK_LENGTH);  // Ahead (South)
    }

    function updateHighway() {
        if (currentMapType !== 'default' || !player1) return;
        const pZ = player1.body.getPosition().y; 
        
        // Determine which chunk index the player is in
        const currentChunkIdx = Math.floor(pZ / CHUNK_LENGTH);

        // Ensure chunks exist at [current-1, current, current+1]
        [-1, 0, 1].forEach(offset => {
            const targetIdx = currentChunkIdx + offset;
            const targetZ = targetIdx * CHUNK_LENGTH;
            
            // Check if chunk exists
            const exists = highwayChunks.some(c => Math.abs(c.zStart - targetZ) < 1);
            if (!exists) {
                createHighwayChunk(targetZ);
            }
        });

        // Cleanup distant chunks
        for (let i = highwayChunks.length - 1; i >= 0; i--) {
            const chunk = highwayChunks[i];
            const chunkIdx = Math.round(chunk.zStart / CHUNK_LENGTH);
            
            if (Math.abs(chunkIdx - currentChunkIdx) > 2) {
                chunk.meshes.forEach(m => { scene.remove(m); if(m.geometry) m.geometry.dispose(); });
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
                    roads.push({ 
                        x: (x * BLOCK_SIZE) - (width * BLOCK_SIZE / 2), 
                        z: (z * BLOCK_SIZE) - (height * BLOCK_SIZE / 2) 
                    });
                }
            }
        }
        return { grid, roads };
    }

    function spawnTraffic() {
        if (loadedTextures.length === 0 || !player1) return;
        
        const pPos = player1.body.getPosition();
        // In updated physics, use mesh rotation or store fwd vector, but simple math works
        const pAngle = player1.body.getAngle();
        const pDir = pl.Vec2(-Math.sin(pAngle), Math.cos(pAngle));

        const spawnRadius = gameParams.spawnRadius;
        const limit = gameParams.trafficCount;

        // --- CULLING ---
        for(let i = trafficPool.length - 1; i >= 0; i--) {
            const car = trafficPool[i];
            const carPos = car.body.getPosition();
            const dist = pl.Vec2.distance(carPos, pPos);
            
            if (dist > spawnRadius) {
                car.markedForDeletion = true; 
            }
        }

        // --- SPAWNING ---
        if (trafficPool.length < limit) {
             const tex = loadedTextures[Math.floor(Math.random() * loadedTextures.length)];
             
             let validTile = null;
             let attempts = 0;
             const spawnMax = spawnRadius - 5;
             const spawnMin = spawnRadius - 45; 

             while(!validTile && attempts < 15) {
                 const tile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
                 const tileVec = pl.Vec2(tile.x, tile.z);
                 const toTile = pl.Vec2.sub(tileVec, pPos);
                 const dist = toTile.length();
                 const dot = pl.Vec2.dot(toTile, pDir);

                 // Spawn generally in front of player, or slightly behind
                 if (dist > spawnMin && dist < spawnMax && dot > -30) {
                     let blocked = false;
                     for(let c of trafficPool) {
                         if(pl.Vec2.distance(c.body.getPosition(), tileVec) < 15) {
                             blocked = true; break;
                         }
                     }
                     if(!blocked) validTile = tile;
                 }
                 attempts++;
             }

             if (!validTile) return; 

             let x = validTile.x;
             let z = validTile.z;
             let angle = 0;
             
             // --- INFINITE HIGHWAY SPAWN LOGIC ---
             if (currentMapType === 'default') {
                 trafficSpawnCounter++;
                 const laneIndex = trafficSpawnCounter % 4;
                 
                 if (laneIndex === 0) x = 2.5;  // Inner Right
                 if (laneIndex === 1) x = 6.5;  // Outer Right
                 if (laneIndex === 2) x = -2.5; // Inner Left
                 if (laneIndex === 3) x = -6.5; // Outer Left
                 
                 if (x > 0) angle = 0; // South
                 else angle = Math.PI; // North
                 
             } else {
                 if (Math.random() > 0.5) angle = 0; else angle = Math.PI/2;
             }

             while (angle <= -Math.PI) angle += 2*Math.PI;
             while (angle > Math.PI) angle -= 2*Math.PI;

             const car = new Car(x, z, false, 0, tex, 'straight', 0);
             car.body.setAngle(angle);
             car.aiTargetAngle = angle;
             car.body.setAwake(true);
             car.speed = gameParams.enemySpeed / 3.6; // Set scalar speed for new physics
             
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

        // --- GTA1 BOUNCE EFFECT ---
        if (entA instanceof Car || entB instanceof Car) {
            const car = entA instanceof Car ? entA : entB;
            // Cut speed drastically on impact
            car.speed *= 0.3;
            // Add a slight random spin to simulate loss of control
            car.body.setAngle(
                car.body.getAngle() + (Math.random() - 0.5) * 0.4
            );
        }

        if(entA.isBullet || entB.isBullet) {
            const bullet = entA.isBullet ? entA : entB;
            const target = entA.isBullet ? entB : entA;
            if(target instanceof Car && !target.isPlayer) {
                bullet.markedForDeletion = true;
                target.markedForDeletion = true; 
                if(bullet.owner === 1) p1Score += 100;
                else p2Score += 100;
                createExplosion(target.mesh.position);
                updateHUD();
            } else if (!target.isPlayer) {
                bullet.markedForDeletion = true; 
            }
        }
    });

    function updateHUD() {
        p1ScoreEl.innerText = `P1: ${p1Score}`;
        p2ScoreEl.innerText = `P2: ${p2Score}`;
    }

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
        updateHighway(); // Bi-directional logic

        world.step(TIME_STEP, velIter, posIter);

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (let i = 0; i < gamepads.length; i++) {
            const gp = gamepads[i];
            if (gp) {
                if (gp.buttons.some((b, idx) => idx < 4 && b.pressed)) {
                    if (gamepadAssignments.p1 === null && gamepadAssignments.p2 !== gp.index) gamepadAssignments.p1 = gp.index;
                    else if (gamepadAssignments.p2 === null && gamepadAssignments.p1 !== gp.index) gamepadAssignments.p2 = gp.index;
                }
            }
        }

        if (player1) {
            let throttle = 0, steer = 0, shoot = false;
            if (keys['arrowup']) throttle = 1; if (keys['arrowdown']) throttle = -1;
            
            // --- INVERTED STEERING (Requested) ---
            // Left key now produces Positive steer (1) -> Turns Right
            // Right key now produces Negative steer (-1) -> Turns Left
            if (keys['arrowleft']) steer = 1; 
            if (keys['arrowright']) steer = -1; 

            if (keys['control']) shoot = true; 
            if (gamepadAssignments.p1 !== null && gamepads[gamepadAssignments.p1]) {
                const gp = gamepads[gamepadAssignments.p1];
                if (Math.abs(gp.axes[0]) > 0.2) steer = -gp.axes[0]; // Inverted Axis
                if (gp.buttons[0]?.pressed || gp.buttons[12]?.pressed) throttle = 1;
                if (gp.buttons[13]?.pressed || gp.axes[1] > 0.5) throttle = -1;
                if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) shoot = true;
            }
            player1.drive(throttle, steer);
            if (shoot) player1.shoot();
        }

        if (player2) {
            let throttle = 0, steer = 0, shoot = false;
            if (keys['w']) throttle = 1; if (keys['s']) throttle = -1;
            
            // --- INVERTED STEERING (Requested) ---
            if (keys['a']) steer = 1; 
            if (keys['d']) steer = -1; 
            
            if (keys['f']) shoot = true;
            if (gamepadAssignments.p2 !== null && gamepads[gamepadAssignments.p2]) {
                const gp = gamepads[gamepadAssignments.p2];
                if (Math.abs(gp.axes[0]) > 0.2) steer = -gp.axes[0]; // Inverted Axis
                if (gp.buttons[0]?.pressed) throttle = 1;
                if (gp.buttons[1]?.pressed) shoot = true;
            }
            player2.drive(throttle, steer);
            if (shoot) player2.shoot();
        }

        trafficPool.forEach(car => {
            if(!car.markedForDeletion) {
                car.update(dt);
                car.aiUpdate(dt);
            }
        });

        // --- ABSOLUTE CULLING ---
        if (player1 && player1.body) {
             const pPos = player1.body.getPosition();
             const radiusSq = gameParams.spawnRadius * gameParams.spawnRadius;
             
             for (let i = entities.length - 1; i >= 0; i--) {
                 if (entities[i] === player1 || entities[i] === player2) {
                     entities[i].update(dt);
                     continue;
                 }
                 entities[i].update(dt);
                 if (entities[i] instanceof Car && !entities[i].isPlayer) {
                     const cPos = entities[i].body.getPosition();
                     const dSq = (cPos.x - pPos.x)**2 + (cPos.y - pPos.y)**2;
                     if (dSq > radiusSq) {
                         entities[i].markedForDeletion = true;
                     }
                 }
                 if (entities[i].markedForDeletion) {
                     entities[i].destroy();
                     entities.splice(i, 1);
                     const idx = trafficPool.indexOf(entities[i]);
                     if(idx > -1) trafficPool.splice(idx, 1);
                 }
             }
        } else {
             for (let i = entities.length - 1; i >= 0; i--) {
                 entities[i].update(dt);
             }
        }

        if (player1 && player1.mesh) {
            if(camera.fov !== gameParams.cameraFOV) {
                camera.fov = gameParams.cameraFOV;
                camera.updateProjectionMatrix();
            }
            const targetX = player1.mesh.position.x;
            const distH = gameParams.topDownMode ? 0.1 : 20; 
            let finalCamX, finalCamZ;
            if (gameParams.cameraRotate) {
                 const angle = player1.body.getAngle(); 
                 finalCamX = targetX + (-Math.sin(angle) * distH);
                 finalCamZ = player1.mesh.position.z + (Math.cos(angle) * distH);
                 if(gameParams.topDownMode) camera.up.set(Math.sin(angle), 0, Math.cos(angle));
                 else camera.up.set(0,1,0);
            } else {
                 finalCamX = targetX;
                 finalCamZ = player1.mesh.position.z + distH;
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
        gameParams.simpleMaterials = document.getElementById('simpleMatToggle').checked;
        gameParams.particlesEnabled = document.getElementById('particlesToggle').checked;
        gameParams.bulletGlow = document.getElementById('bulletGlowToggle').checked;
        if(document.getElementById('litePhysicsToggle').checked) { velIter = 2; posIter = 1; }
        
        document.getElementById('startScreen').classList.add('hidden');
        document.getElementById('customizeMenu').classList.add('hidden');
        document.getElementById('gameHeader').classList.remove('hidden');
        document.getElementById('hud').classList.remove('hidden');
        isPaused = false;
        
        loadAssets().then(() => {
            entities.forEach(e => e.destroy());
            entities = [];
            trafficPool = [];
            
            if(type === 'default') {
                createCity(); // Starts the infinite highway
            } else {
                // Maze/City Generation Mode
                let w=20, h=20;
                if(type === 'medium') {w=40; h=40;}
                if(type === 'large') {w=60; h=60;}
                
                const data = generateMazeData(w,h);
                mapGrid = data.grid;
                roadTiles = data.roads;
                buildRoadLookup();

                const pg = new THREE.PlaneGeometry(w*BLOCK_SIZE*1.2, h*BLOCK_SIZE*1.2);
                const roadTex = createProceduralTexture('road');
                roadTex.repeat.set(w, h);
                const pm = gameParams.simpleMaterials ? new THREE.MeshLambertMaterial({map: roadTex}) : new THREE.MeshStandardMaterial({map: roadTex});
                const g = new THREE.Mesh(pg, pm);
                g.rotation.x = -Math.PI/2; g.position.y = -0.1;
                scene.add(g);

                const boxGeo = new THREE.BoxGeometry(1,1,1);
                const wallOffX = w * BLOCK_SIZE / 2;
                const wallOffZ = h * BLOCK_SIZE / 2;

                for (let z = 0; z < h; z++) {
                    for (let x = 0; x < w; x++) {
                        if (mapGrid[z][x] === '#') {
                            const height = Math.random() * 25 + 5;
                            const buildTex = createProceduralTexture('building');
                            buildTex.repeat.set(BLOCK_SIZE/10, height/10);
                            const bMat = gameParams.simpleMaterials ? new THREE.MeshLambertMaterial({map: buildTex}) : new THREE.MeshStandardMaterial({map: buildTex});
                            const mesh = new THREE.Mesh(boxGeo, bMat);
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
            entities.push(player1);
            entities.push(player2);
            
            gameActive = true;
            animate(0);
        });
    };

    // --- UI & Event Listeners ---
    const customMenuGroup = document.querySelector('#customizeMenu .setting-group');
    if(customMenuGroup && !document.getElementById('bulletGlowToggle')) {
        const div = document.createElement('div');
        div.className = 'setting-row';
        div.innerHTML = '<label>Bullet Glow:</label><input type="checkbox" id="bulletGlowToggle">';
        customMenuGroup.appendChild(div);
    }

    const gameplayGroup = document.querySelectorAll('#customizeMenu .setting-group')[2]; 
    if(gameplayGroup && !document.getElementById('radiusSlider')) {
        const div = document.createElement('div');
        div.className = 'setting-row';
        div.innerHTML = '<label>Traffic Radius:</label><input type="range" id="radiusSlider" min="50" max="300" step="10" value="120"><span class="slider-value" id="radiusValue">120</span>';
        gameplayGroup.appendChild(div);
    }
    
    // --- AI Selector Logic ---
    const aiSelect = document.getElementById('aiModeSelect');
    if (aiSelect) {
        aiSelect.addEventListener('change', (e) => {
            gameParams.aiMode = e.target.value;
            console.log("AI Mode switched to:", gameParams.aiMode);
        });
    }

    function toggleMenu(menu) {
        const isHidden = menu.classList.contains('hidden');
        helpMenu.classList.add('hidden');
        customizeMenu.classList.add('hidden');
        if (isHidden) { menu.classList.remove('hidden'); isPaused = true; } 
        else { isPaused = false; }
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
    document.getElementById('shadowsToggle').addEventListener('change', (e) => {
        dirLight.castShadow = e.target.checked;
        renderer.shadowMap.autoUpdate = e.target.checked;
        if(!e.target.checked) renderer.clearTarget(dirLight.shadow.map);
    });
    document.getElementById('headlightsToggle').addEventListener('change', (e) => gameParams.headlightsEnabled = e.target.checked);
    document.getElementById('bulletGlowToggle').addEventListener('change', (e) => gameParams.bulletGlow = e.target.checked);
    document.getElementById('lowResToggle').addEventListener('change', (e) => renderer.setPixelRatio(e.target.checked ? 0.5 : window.devicePixelRatio));
    document.getElementById('litePhysicsToggle').addEventListener('change', (e) => { velIter = e.target.checked ? 2 : 8; posIter = e.target.checked ? 1 : 3; });
    document.getElementById('simpleMatToggle').addEventListener('change', (e) => gameParams.simpleMaterials = e.target.checked);
    document.getElementById('particlesToggle').addEventListener('change', (e) => gameParams.particlesEnabled = e.target.checked);
    document.getElementById('topDownToggle').addEventListener('change', (e) => gameParams.topDownMode = e.target.checked);
    document.getElementById('camRotateToggle').addEventListener('change', (e) => gameParams.cameraRotate = e.target.checked);
    document.getElementById('camHeightSlider').addEventListener('input', (e) => { gameParams.cameraHeight = parseInt(e.target.value); document.getElementById('camHeightValue').innerText = e.target.value; });
    document.getElementById('fovSlider').addEventListener('input', (e) => { gameParams.cameraFOV = parseInt(e.target.value); document.getElementById('fovValue').innerText = e.target.value; });
    const updateSlider = (id, paramKey, displayId) => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', (e) => { gameParams[paramKey] = parseInt(e.target.value); document.getElementById(displayId).innerText = parseInt(e.target.value); });
    };
    updateSlider('playerSpeedSlider', 'playerSpeed', 'playerSpeedValue');
    updateSlider('enemySpeedSlider', 'enemySpeed', 'enemySpeedValue');
    updateSlider('densitySlider', 'trafficCount', 'densityValue');
    
    const rSlider = document.getElementById('radiusSlider');
    if(rSlider) {
        rSlider.addEventListener('input', (e) => {
             const val = parseInt(e.target.value);
             gameParams.spawnRadius = val;
             document.getElementById('radiusValue').innerText = val;
             scene.fog.far = val + 40; 
        });
    }
});
