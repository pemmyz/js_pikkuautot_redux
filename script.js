document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration Constants ---
    const ASSET_FOLDER = 'auto/';
    const MAX_ASSETS = 9; 
    const BLOCK_SIZE = 20; 
    
    // --- Physics Settings (Planck) ---
    const pl = planck;
    const TIME_STEP = 1 / 60;
    
    // Dynamic physics iterations for optimization
    let velIter = 6; 
    let posIter = 2; 

    // --- State Variables ---
    let isPaused = false;
    let gameActive = false;
    let loadedTextures = [];
    let currentMapType = 'default';
    
    let gamepadAssignments = { p1: null, p2: null }; 

    let gameParams = {
        playerSpeed: 100,
        enemySpeed: 60, 
        turnSpeed: 2.5,  
        drift: 0.85,
        trafficCount: 25, 
        simpleMaterials: false, 
        particlesEnabled: true,
        headlightsEnabled: false,
        bulletGlow: false,
        cameraHeight: 60,
        cameraFOV: 50,
        topDownMode: false,
        cameraRotate: false 
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
    
    if (document.getElementById('lowResToggle').checked) {
        renderer.setPixelRatio(0.5);
    } else {
        renderer.setPixelRatio(window.devicePixelRatio);
    }
    
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.fog = new THREE.Fog(0x222222, 50, 150);

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
        constructor(x, y, isPlayer, playerIndex, texture, aiType = 'chaotic') {
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
                linearDamping: 0.5, 
                angularDamping: 2.0 
            });

            body.createFixture(pl.Box(width / 2, height / 2), {
                density: 2.0, friction: 0.3, restitution: 0.1,
                filterCategoryBits: isPlayer ? CAT_PLAYER : CAT_ENEMY,
                filterMaskBits: CAT_PLAYER | CAT_ENEMY | CAT_WALL | CAT_BULLET
            });

            super(containerMesh, body);
            this.isPlayer = isPlayer;
            this.playerIndex = playerIndex;
            this.shootCooldown = 0;
            this.maxSpeed = isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;
            this.power = isPlayer ? 100 : 70; 
            
            this.aiTargetAngle = 0;
            this.lastDecisionTile = null;
            
            // AI Personality
            // 'left': Always turn left
            // 'right': Always turn right
            // 'patrol': 2 straight, 1 left
            // 'chaotic': Random turns
            this.aiType = aiType;
            this.aiCounter = 0; // used for patrol logic
        }

        update(dt) {
            super.update();
            if (this.shootCooldown > 0) this.shootCooldown -= dt;
            
            const lateralVel = getLateralVelocity(this.body);
            const driftFactor = this.isPlayer ? gameParams.drift : 1.0; 
            const impulse = lateralVel.neg().mul(this.body.getMass() * driftFactor);
            this.body.applyLinearImpulse(impulse, this.body.getWorldCenter());

            this.body.applyAngularImpulse( -0.1 * this.body.getAngularVelocity() * this.body.getMass() );
            this.maxSpeed = this.isPlayer ? gameParams.playerSpeed : gameParams.enemySpeed;
        }

        aiUpdate(dt) {
            if (this.isPlayer) return;

            const pos = this.body.getPosition();
            const vel = this.body.getLinearVelocity().length();
            
            // Calculate tile position
            const tileX = Math.round(pos.x / BLOCK_SIZE) * BLOCK_SIZE;
            const tileZ = Math.round(pos.y / BLOCK_SIZE) * BLOCK_SIZE;
            const tileKey = `${tileX},${tileZ}`;
            const distToCenter = pl.Vec2.distance(pos, pl.Vec2(tileX, tileZ));

            // --- STUCK FIX (ONLY IF STOPPED) ---
            // If car is almost stopped (vel < 0.5) and unlucky, reset it
            // Removed distance check to prevent rubber-banding
            if (vel < 0.5 && Math.random() < 0.02) {
                // Check if current tile is actually a road
                if (roadLookup[tileKey]) {
                    this.body.setPosition(pl.Vec2(tileX, tileZ));
                    this.body.setAngle(this.aiTargetAngle);
                    this.body.setAngularVelocity(0);
                    const forward = this.body.getWorldVector(pl.Vec2(0, 1));
                    this.body.setLinearVelocity(forward.mul(this.maxSpeed / 3.6));
                    this.lastDecisionTile = null; 
                    return; 
                }
            }

            // Logic: Drive, check for turns
            if (distToCenter < 3.0 && this.lastDecisionTile !== tileKey && currentMapType !== 'default') {
                this.lastDecisionTile = tileKey;
                this.makeTurnDecision(tileX, tileZ);
            }

            const currentAngle = this.body.getAngle();
            let angleDiff = this.aiTargetAngle - currentAngle;
            while (angleDiff <= -Math.PI) angleDiff += 2*Math.PI;
            while (angleDiff > Math.PI) angleDiff -= 2*Math.PI;

            if (Math.abs(angleDiff) > 0.1) {
                // Turning
                this.body.setAngularVelocity(angleDiff * 3.0);
                const forward = this.body.getWorldVector(pl.Vec2(0, 1));
                const turnSpeed = this.maxSpeed * 0.4;
                this.body.setLinearVelocity(forward.mul(turnSpeed / 3.6));
            } else {
                // Cruising
                this.body.setAngularVelocity(0);
                const forward = this.body.getWorldVector(pl.Vec2(0, 1));
                this.body.setLinearVelocity(forward.mul(this.maxSpeed / 3.6));
            }
        }

        makeTurnDecision(cx, cz) {
            // Available exits
            const neighbors = [
                { dir: 0, x: cx, z: cz - BLOCK_SIZE, angle: 0 },         // N
                { dir: 1, x: cx + BLOCK_SIZE, z: cz, angle: -Math.PI/2 },// E
                { dir: 2, x: cx, z: cz + BLOCK_SIZE, angle: Math.PI },   // S
                { dir: 3, x: cx - BLOCK_SIZE, z: cz, angle: Math.PI/2 }  // W
            ];

            // Only valid roads
            const valid = neighbors.filter(n => roadLookup[`${n.x},${n.z}`]);
            if (valid.length === 0) return; 

            // Calculate Relative Directions
            const getRel = (target) => {
                let diff = target - this.aiTargetAngle;
                while (diff <= -Math.PI) diff += 2*Math.PI;
                while (diff > Math.PI) diff -= 2*Math.PI;
                return diff;
            };

            const straight = valid.find(n => Math.abs(getRel(n.angle)) < 0.1);
            // +PI/2 is Left, -PI/2 is Right
            const left     = valid.find(n => Math.abs(getRel(n.angle) - Math.PI/2) < 0.1); 
            const right    = valid.find(n => Math.abs(getRel(n.angle) + Math.PI/2) < 0.1);

            let selected = null;

            if (this.aiType === 'left') {
                selected = left || straight || right;
            } 
            else if (this.aiType === 'right') {
                selected = right || straight || left;
            } 
            else if (this.aiType === 'patrol') {
                // 2 Straight, 1 Left
                if (this.aiCounter < 2) {
                    if (straight) {
                        selected = straight;
                        this.aiCounter++;
                    } else {
                        // Forced to turn
                        selected = left || right;
                        // Reset counter if we couldn't go straight
                        this.aiCounter = 0;
                    }
                } else {
                    selected = left || straight || right;
                    this.aiCounter = 0;
                }
            } 
            else { 
                // Chaotic / Default
                // Prefer Turns over Straight (Turn on every intersection logic)
                const turns = [];
                if(left) turns.push(left);
                if(right) turns.push(right);
                
                if(turns.length > 0) {
                    selected = turns[Math.floor(Math.random() * turns.length)];
                } else {
                    selected = straight;
                }
            }

            // Fallback (e.g. Dead end u-turn)
            if (!selected) {
                // Pick any valid that isn't U-turn if possible
                const nonU = valid.filter(n => Math.abs(getRel(n.angle) - Math.PI) > 0.1);
                if(nonU.length > 0) selected = nonU[Math.floor(Math.random()*nonU.length)];
                else selected = valid[0];
            }

            this.aiTargetAngle = selected.angle;
        }

        drive(throttle, steer) {
            if (steer !== 0) {
                const turnForce = gameParams.turnSpeed * (throttle < 0 ? 1 : -1); 
                this.body.setAngularVelocity(steer * -turnForce);
            } else {
                this.body.setAngularVelocity(0);
            }

            if (throttle !== 0) {
                const forwardNormal = this.body.getWorldVector(pl.Vec2(0, 1));
                const currentSpeed = pl.Vec2.dot(this.body.getLinearVelocity(), forwardNormal);
                if (Math.abs(currentSpeed) < this.maxSpeed) {
                    const force = forwardNormal.mul(throttle * this.power);
                    this.body.applyForce(force, this.body.getWorldCenter());
                }
            }
        }

        shoot() {
            if (this.shootCooldown > 0) return;
            const pos = this.body.getPosition();
            const fwd = this.body.getWorldVector(pl.Vec2(0, 1));
            const right = this.body.getWorldVector(pl.Vec2(1, 0));
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
        
        // Conditional Glow
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

    // --- Environment Generation ---
    function buildRoadLookup() {
        roadLookup = {};
        roadTiles.forEach(t => {
            roadLookup[`${t.x},${t.z}`] = true;
        });
    }

    function createCity() {
        const planeGeo = new THREE.PlaneGeometry(400, 400);
        const roadTex = createProceduralTexture('road');
        roadTex.repeat.set(40, 40);
        const matType = gameParams.simpleMaterials ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
        const planeMat = new matType({ map: roadTex, side: THREE.DoubleSide });
        const ground = new THREE.Mesh(planeGeo, planeMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);
        createWall(-40, 0, 2, 400); createWall(40, 0, 2, 400);
        const boxGeo = new THREE.BoxGeometry(1,1,1);
        for(let z=-200; z<200; z+=12) {
            createBuildingBlock(-35, z, boxGeo); createBuildingBlock(35, z, boxGeo);
        }
        roadTiles = [];
        for(let z=-200; z<200; z+=20) {
            roadTiles.push({x: -15, z: z}); roadTiles.push({x: 0, z: z}); roadTiles.push({x: 15, z: z});
        }
        buildRoadLookup();
    }

    function createBuildingBlock(x, z, geo) {
        const h = Math.random() * 15 + 5;
        const w = Math.random() * 8 + 6;
        const buildTex = createProceduralTexture('building');
        buildTex.repeat.set(w/10, h/10);
        const mat = gameParams.simpleMaterials ? new THREE.MeshLambertMaterial({ map: buildTex }) : new THREE.MeshStandardMaterial({ map: buildTex, roughness: 0.2 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, h/2, z);
        mesh.scale.set(w, h, w);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh);
        const body = world.createBody(pl.Vec2(x, z));
        body.createFixture(pl.Box(w/2, w/2), { filterCategoryBits: CAT_WALL });
    }

    function createWall(x, z, w, h) {
        const body = world.createBody(pl.Vec2(x, z));
        body.createFixture(pl.Box(w/2, h/2), { filterCategoryBits: CAT_WALL });
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
        // Get player forward direction
        const pDir = player1.body.getWorldVector(pl.Vec2(0, 1)); 

        const spawnRadiusMin = 40;
        const spawnRadiusMax = 110; 
        const limit = gameParams.trafficCount;

        // --- CULLING (Despawn behind player or out of view) ---
        for(let i = trafficPool.length - 1; i >= 0; i--) {
            const car = trafficPool[i];
            const carPos = car.body.getPosition();
            
            // Vector from Player to Car
            const toCar = pl.Vec2.sub(carPos, pPos);
            const dist = toCar.length();
            
            // Dot product determines if in front or behind
            const dot = pl.Vec2.dot(toCar, pDir);

            // Remove if far away OR (moderately far AND behind player)
            if(dist > spawnRadiusMax * 1.3 || (dot < -20 && dist > 30)) {
                car.markedForDeletion = true; 
            }
        }

        if (trafficPool.length < limit) {
             const tex = loadedTextures[Math.floor(Math.random() * loadedTextures.length)];
             
             let validTile = null;
             let attempts = 0;
             
             // Try to find a tile IN FRONT of the player
             while(!validTile && attempts < 15) {
                 const tile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
                 const tileVec = pl.Vec2(tile.x, tile.z);
                 const toTile = pl.Vec2.sub(tileVec, pPos);
                 const dist = toTile.length();
                 const dot = pl.Vec2.dot(toTile, pDir);

                 // Valid if: Within range AND In front of player
                 if (dist > spawnRadiusMin && dist < spawnRadiusMax && dot > -10) {
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

             // Determine Spawn position and angle to drive TOWARDS player or correct lane
             let x = validTile.x;
             let z = validTile.z;
             let angle = 0;
             const laneOffset = 4.5;

             if (currentMapType === 'default') {
                 const pAngle = player1.body.getAngle();
                 if (Math.random() > 0.3) {
                     // Oncoming!
                     angle = pAngle + Math.PI; 
                     x = (Math.cos(angle) > 0) ? x + laneOffset : x - laneOffset;
                 } else {
                     angle = pAngle;
                     x = (Math.cos(angle) > 0) ? x - laneOffset : x + laneOffset;
                 }
             } else {
                 // City Mode: Pick direction that faces roughly towards player or grid
                 const dx = pPos.x - x;
                 const dz = pPos.y - z;
                 
                 // Snap to 4 cardinal directions
                 if (Math.abs(dx) > Math.abs(dz)) {
                     // Horizontal
                     if (dx > 0) { angle = -Math.PI/2; z -= laneOffset; } // Face East
                     else { angle = Math.PI/2; z += laneOffset; }         // Face West
                 } else {
                     // Vertical
                     if (dz > 0) { angle = 0; x += laneOffset; }          // Face North
                     else { angle = Math.PI; x -= laneOffset; }           // Face South
                 }
             }

             // Normalize angle
             while (angle <= -Math.PI) angle += 2*Math.PI;
             while (angle > Math.PI) angle -= 2*Math.PI;

             // Randomize AI Personality
             const types = ['left', 'right', 'patrol', 'chaotic'];
             const type = types[Math.floor(Math.random() * types.length)];

             const car = new Car(x, z, false, 0, tex, type);
             car.body.setAngle(angle);
             car.aiTargetAngle = angle;
             car.body.setAngularVelocity(0);
             car.body.setAwake(true);
             const fwd = car.body.getWorldVector(pl.Vec2(0, 1));
             car.body.setLinearVelocity(fwd.mul(gameParams.enemySpeed / 3.6));
             
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
            if (keys['arrowleft']) steer = -1; if (keys['arrowright']) steer = 1;
            if (keys[' ']) shoot = true;
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
            let throttle = 0, steer = 0, shoot = false;
            if (keys['w']) throttle = 1; if (keys['s']) throttle = -1;
            if (keys['a']) steer = -1; if (keys['d']) steer = 1;
            if (keys['f']) shoot = true;
            if (gamepadAssignments.p2 !== null && gamepads[gamepadAssignments.p2]) {
                const gp = gamepads[gamepadAssignments.p2];
                if (Math.abs(gp.axes[0]) > 0.2) steer = gp.axes[0];
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

        for (let i = entities.length - 1; i >= 0; i--) {
            // FIX: Ensure ALL entities (especially AI cars) update visual mesh
            if(entities[i] === player1 || entities[i] === player2) entities[i].update(dt);
            else entities[i].update(dt);

            if (entities[i].markedForDeletion) {
                entities[i].destroy();
                entities.splice(i, 1);
                const idx = trafficPool.indexOf(entities[i]);
                if(idx > -1) trafficPool.splice(idx, 1);
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
                 finalCamZ = player1.mesh.position.z + (-Math.cos(angle) * distH);
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
                createCity();
            } else {
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
});
