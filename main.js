/* =========================================================
   Cap infant sense regal · Fundació ITACA
   main.js — regals 3D que suben com globus + físiques de ratolí
   ---------------------------------------------------------
   · Un sol canvas WebGL (three.js) amb càmera ortogràfica: 1 unitat = 1 px del cartell.
   · Els models .glb venen de models/models.js (base64) perquè funcioni
     també obrint index.html directament (file://), sense servidor.
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIGURACIÓ
   --------------------------------------------------------- */
const CONFIG = {
  POSTER_W: 848,
  POSTER_H: 1200,

  // Cicle: omple la pantalla de cop → es queda plena → se'n van tots alhora → torna a començar
  GIFT_COUNT: 37,
  MIN_SIZE: 150,        // mida màxima del model (px)
  MAX_SIZE: 230,
  SPAWN_INTERVAL: 0.07, // segons entre regal i regal en omplir
  SPAWN_LANES: 12,      // carrils de sortida repartits per l'amplada
  FILL_SETTLE: 2.2,     // segons d'espera perquè s'assenti el munt un cop han sortit tots
  FULL_HOLD: 2.6,       // segons que la pantalla es queda plena abans de marxar tots
  PAUSE: 1.5,           // pausa buida entre cicles (el cartell sencer queda llegible)
  SENSE_OUT_AT: 1.8,    // segon del llenat en què "SENSE" comença a desaparèixer (quan el munt ja el tapa)

  RISE_MIN: 420,        // velocitat de flotació (px/s)
  RISE_MAX: 620,
  LEAVE_SPEED: 1300,    // velocitat de la fuga col·lectiva cap amunt

  CEILING_BOUNCE: 0.25, // rebot contra el sostre
  WALL_BOUNCE: 0.5,     // rebot contra les parets laterals
  GIFT_BOUNCE: 0.35,    // rebot entre regals (baix = el munt s'assenta)
  OVERLAP: 0.95,        // 1 = es toquen just; menys = es poden solapar més
  AIR_DRAG: 3.5,        // com de ràpid torna a la velocitat de flotació
  QUAD_DRAG: 0.0016,    // fregament quadràtic: frena els cops forts
  MAX_SPEED: 1500,
  SPIN_DECAY: 2.2,      // com de ràpid s'atura el gir (ease-out): ~1,5 s fins a quedar quiet
  MAX_SPIN: 4.5,        // velocitat de gir màxima (rad/s)

  CURSOR_RADIUS: 34,    // "cos" del cursor
  CURSOR_PUSH: 0.6,     // quanta velocitat del ratolí es transmet
  CLICK_IMPULSE: 520,   // empenta en fer clic sobre un regal

  TILT_X: 0.32,         // inclinació perquè es vegi la tapa de dalt

  // Ombres: la llum cau des d'a dalt a l'esquerra i l'ombra es projecta sobre el cartell
  SHADOW_OPACITY: 0.3,
  SHADOW_DEPTH: 110,    // distància del "paper" al darrere dels regals (més = ombra més separada)
  LIGHT_DIR: [0.16, -0.24, -1],

  // Efectes d'impacte
  FX_GIFT_MIN_SPEED: 170, // velocitat de xoc mínima entre regals per treure efecte
  FX_MAX_ACTIVE: 14,      // màxim d'efectes simultanis (per no saturar el DOM)
};

/* Mida relativa extra per a models concrets (nom del .glb -> factor) */
const MODEL_SCALE = {};

/**
 * Regals fixos de fons: sempre iguals, sense física ni col·lisions, darrere dels que pugen.
 * Ocupen els espais buits a la dreta del titular, de manera que el cartell ja "diu" de què va
 * abans que comenci l'animació. Coordenades en px del cartell (x, y = centre).
 */
const STATIC_GIFTS = [
  { model: "gift_1",           x: 585, y: 140, size: 205, yaw: 0.5,  roll: -0.05 },
  { model: "gift_-_3december", x: 774, y: 196, size: 118, yaw: -0.6, roll: 0.06 },
  { model: "gift_scene",       x: 764, y: 392, size: 175, yaw: 0.9,  roll: 0.04 },
  { model: "gift_box_1",       x: 742, y: 630, size: 175, yaw: -0.4, roll: -0.04 },
  { model: "a_gift_box",       x: 717, y: 868, size: 175, yaw: 0.7,  roll: 0.05 },
];
const STATIC_Z = -100;   // darrere dels regals que pugen (que van de z ≈ 20 endavant)

/* ---------------------------------------------------------
   2. ESTAT
   --------------------------------------------------------- */
const poster = document.getElementById("poster");
const giftsLayer = document.getElementById("gifts");
const fx = document.getElementById("fx");

const gifts = [];
const templates = {};         // nom del model -> { object, usage }
const mouse = { x: 0, y: 0, vx: 0, vy: 0, active: false, t: 0 };
let scale = 1;
let frozen = false;
let lastTime = 0;

// Cicle global: fill (surten) → full (plena) → release (marxen tots) → pausa → fill…
const cycle = { phase: "fill", t: 0, spawnEnd: 0 };
let fxActive = 0;
let simClock = 0;                 // temps de simulació (també avança en la captura accelerada)
const pairLast = new Map();       // parella de regals -> últim instant en contacte

let renderer, scene, camera;

/* ---------------------------------------------------------
   3. UTILITATS
   --------------------------------------------------------- */
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function limitSpeed(g) {
  const s = Math.hypot(g.vx, g.vy);
  if (s > CONFIG.MAX_SPEED) {
    g.vx *= CONFIG.MAX_SPEED / s;
    g.vy *= CONFIG.MAX_SPEED / s;
  }
}

/* ---------------------------------------------------------
   4. ESCENA THREE.JS I CÀRREGA DE MODELS
   --------------------------------------------------------- */
function setupScene() {
  const { POSTER_W: W, POSTER_H: H } = CONFIG;

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(W, H, false);
  giftsLayer.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  // Càmera ortogràfica en píxels del cartell. Posició Y de three = H - y del DOM.
  camera = new THREE.OrthographicCamera(0, W, H, 0, -3000, 3000);
  camera.position.z = 1000;

  // Il·luminació basada en imatge (reflexos suaus a llaços i papers) + llum principal amb ombra
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8a99a, 0.3));

  const sun = new THREE.DirectionalLight(0xfff3e4, 1.5);
  const dir = new THREE.Vector3(...CONFIG.LIGHT_DIR).normalize();
  sun.target.position.set(W / 2, H / 2, 0);
  sun.position.copy(sun.target.position).addScaledVector(dir, -1800);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -W * 0.9;
  sun.shadow.camera.right = W * 0.9;
  sun.shadow.camera.top = H * 0.9;
  sun.shadow.camera.bottom = -H * 0.9;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 4000;
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);

  // "Paper" invisible que només rep l'ombra (també cau sobre les lletres del titular)
  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 2, H * 2),
    new THREE.ShadowMaterial({ color: 0x14141f, opacity: CONFIG.SHADOW_OPACITY })
  );
  catcher.position.set(W / 2, H / 2, -CONFIG.SHADOW_DEPTH);
  catcher.receiveShadow = true;
  scene.add(catcher);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Carrega tots els .glb de GIFT_MODELS; cada un queda centrat i normalitzat a mida 1. */
function loadModels() {
  const loader = new THREE.GLTFLoader();
  const names = Object.keys(window.GIFT_MODELS || {});

  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          loader.parse(
            base64ToArrayBuffer(window.GIFT_MODELS[name]),
            "",
            (gltf) => {
              const obj = gltf.scene;
              obj.traverse((m) => {
                if (!m.isMesh) return;
                m.castShadow = true;
                m.receiveShadow = true;
                const mats = Array.isArray(m.material) ? m.material : [m.material];
                mats.forEach((mat) => {
                  mat.envMapIntensity = 0.5;
                  if ("roughness" in mat) mat.roughness = Math.min(mat.roughness ?? 0.6, 0.65);
                });
              });
              const box = new THREE.Box3().setFromObject(obj);
              const size = box.getSize(new THREE.Vector3());
              const center = box.getCenter(new THREE.Vector3());
              obj.position.sub(center); // centrat a l'origen

              const holder = new THREE.Group();
              holder.add(obj);
              holder.scale.setScalar((MODEL_SCALE[name] ?? 1) / Math.max(size.x, size.y, size.z));

              templates[name] = { object: holder, usage: 0 };
              resolve();
            },
            (err) => {
              console.warn("No s'ha pogut carregar el model", name, err);
              resolve();
            }
          );
        })
    )
  );
}

/* ---------------------------------------------------------
   5. CREACIÓ DELS REGALS
   --------------------------------------------------------- */

/**
 * Variació de color: cada regal rep un desplaçament de to propi als materials de color pla.
 * Els papers blancs/grisos es pinten d'un pastís aleatori. Els models amb textura ja tenen
 * variants de color pròpies (_h120, _h200…) generades en optimitzar els .glb.
 */
/**
 * Acabat realista NOMÉS per als regals que pugen (els materials són còpies pròpies; els regals de fons no es toquen).
 * Sense cap desenfocament: tot és il·luminació.
 *  · llum de vora freda (fresnel) que perfila cada regal, com un contrallum de cinema
 *  · gradació: llums càlides, ombres fredes i una mica més de contrast
 *  · profunditat atmosfèrica: els regals lluny (petits) s'enfosqueixen i es desatureen lleugerament
 * depthU.value: 0 = lluny … 1 = a prop.
 */
/** Esferes (x, y, z, radi) de tots els regals, pujades a la GPU cada fotograma per a l'oclusió ambiental. */
const sphereU = { value: Array.from({ length: CONFIG.GIFT_COUNT }, () => new THREE.Vector4(0, 0, 0, 0)) };

const AO_GLSL = `
  uniform vec4 uSpheres[${CONFIG.GIFT_COUNT}];
  uniform float uSelf;
  varying vec3 vWPos;

  // Oclusió ambiental analítica d'una esfera sobre un punt (Quilez): com de tapat queda el punt per aquesta esfera
  float sphOcclusion(vec3 pos, vec3 nor, vec4 sph) {
    vec3 di = sph.xyz - pos;
    float l = length(di);
    float nl = dot(nor, di / l);
    float h = l / sph.w;
    float h2 = h * h;
    float k2 = 1.0 - h2 * nl * nl;
    float res = max(0.0, nl) / h2;
    if (k2 > 0.0001 && h2 > 1.0) {
      res = nl * acos(clamp(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl)), -1.0, 1.0)) - sqrt(k2 * (h2 - 1.0));
      res = res / h2 + atan(sqrt(k2 / (h2 - 1.0)));
      res /= 3.141593;
    }
    return clamp(res, 0.0, 1.0);
  }
`;

function giftShading(mat, depthU, selfU, withRim) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDepth = depthU;
    shader.uniforms.uSpheres = sphereU;
    shader.uniforms.uSelf = selfU;
    // món: posició de cada fragment en coordenades del cartell (per mesurar la distància als altres regals)
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', "varying vec3 vWPos;\nvoid main() {")
      .replace('#include <begin_vertex>', "#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', "uniform float uDepth;\n" + AO_GLSL + "\nvoid main() {")
      .replace('#include <output_fragment>', `
        // Ombres de contacte: oclusió ambiental dels altres regals (apilats, es toquen i es tapen entre ells)
        vec3 aoN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        if (aoN.z < 0.0) aoN = -aoN;
        float aoKeep = 1.0;
        for (int i = 0; i < ${CONFIG.GIFT_COUNT}; i++) {
          if (float(i) == uSelf || uSpheres[i].w <= 0.0) continue;
          aoKeep *= 1.0 - sphOcclusion(vWPos, aoN, uSpheres[i]);
        }
        float ao = 1.0 - aoKeep;
        outgoingLight *= mix(vec3(1.0), vec3(0.50, 0.53, 0.68), clamp(ao * 1.15, 0.0, 0.85));
        ${withRim ? `
        float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 5.0);
        outgoingLight += vec3(0.50, 0.68, 1.0) * rimF * (0.06 + 0.16 * uDepth);` : ''}
        float fxLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.07, 1.01, 0.92), smoothstep(0.30, 1.0, fxLum));
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.90, 0.98, 1.10), 1.0 - smoothstep(0.0, 0.30, fxLum));
        outgoingLight = (outgoingLight - 0.18) * 1.08 + 0.18;
        float fxFar = 1.0 - uDepth;
        outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))), 0.16 * fxFar);
        outgoingLight *= 1.0 - 0.17 * fxFar;
        outgoingLight = max(outgoingLight, 0.0);
        #include <output_fragment>`);
  };
  mat.customProgramCacheKey = () => (withRim ? "giftfx-rim" : "giftfx");
}

function tintModel(model, gift) {
  const shift = Math.random();
  const hsl = {};
  gift.mats = [];
  model.traverse((m) => {
    if (!m.isMesh) return;
    const list = Array.isArray(m.material) ? m.material : [m.material];
    const out = list.map((mat) => {
      const c = mat.clone();             // cada regal té els seus materials (permet l'esclat de llum)
      c.userData.tinted = true;
      if (!mat.map && !mat.isMeshBasicMaterial) {
        c.color.getHSL(hsl);
        if (hsl.s < 0.15) {
          // blanc o gris → pastís (o es queda blanc de tant en tant)
          if (Math.random() < 0.7) c.color.setHSL((shift + 0.5) % 1, 0.6, clamp(hsl.l, 0.62, 0.78));
        } else {
          c.color.setHSL((hsl.h + shift) % 1, hsl.s, hsl.l);
        }
      }
      // més brillantor i reflexos: els papers i llaços llueixen més
      if ("roughness" in c) c.roughness = clamp(c.roughness * 0.9, 0.2, 0.6);
      if ("envMapIntensity" in c) c.envMapIntensity = 0.5;
      giftShading(c, gift.depthU, gift.selfU, !c.isMeshBasicMaterial);
      gift.mats.push({ mat: c, base: c.color.clone() });
      return c;
    });
    m.material = Array.isArray(m.material) ? out : out[0];
  });
}

function disposeTintedMaterials(model) {
  model.traverse((m) => {
    if (!m.isMesh) return;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.userData.tinted && mat.dispose());
  });
}

/** Col·loca els regals fixos de fons (no entren a `gifts`: no es mouen ni col·lisionen). */
function createStaticGifts() {
  STATIC_GIFTS.forEach((cfg) => {
    const tpl = templates[cfg.model];
    if (!tpl) return;
    const pivot = new THREE.Group();
    const model = tpl.object.clone(true);
    model.scale.multiplyScalar(cfg.size);
    model.rotation.y = cfg.yaw;
    pivot.add(model);
    pivot.position.set(cfg.x, CONFIG.POSTER_H - cfg.y, STATIC_Z);
    pivot.rotation.set(CONFIG.TILT_X, 0, cfg.roll, "ZXY");
    scene.add(pivot);
  });
}

/** Escull el model menys usat ara mateix perquè hi hagi sempre varietat. */
function pickModelName() {
  const names = Object.keys(templates);
  const min = Math.min(...names.map((n) => templates[n].usage));
  return pick(names.filter((n) => templates[n].usage === min));
}

function createGift(index) {
  const pivot = new THREE.Group();   // posició + inclinació
  scene.add(pivot);

  const gift = {
    pivot,
    model: null,
    name: null,
    size: 0,
    r: 0,
    lane: -1,
    x: 0, y: 0, vx: 0, vy: 0,
    yaw: rand(0, Math.PI * 2),
    spin: 0,
    baseSpin: 0,
    mass: 1,
    roll: 0, rollV: 0,       // balanceig lateral (molla amortida)
    pitch: CONFIG.TILT_X, pitchV: 0,
    squash: 0, squashV: 0,   // aixafament en xocar
    touching: false,         // el cursor el toca ara mateix
    atCeiling: false,
    pop: 0, popV: 0,         // "salt" elàstic d'escala en rebre un cop
    mats: [],
    selfU: { value: index },  // índex d'aquest regal: no s'ocludeix a si mateix
    depthU: { value: 1 },    // 0 = lluny (petit) … 1 = a prop (gran), per a l'acabat dels materials
    lastFx: 0,
    state: "wait",   // wait → rise → leave → gone
    delay: 0,
    t: 0,
    riseSpeed: 0,
    seed: Math.random() * 10,
  };

  gift.index = index;
  gift.zJitter = (index % 7) * 14;
  resetGift(gift, 999);
  gifts.push(gift);
  return gift;
}

/* Baralla de carrils de sortida (index 0..LANES-1), barrejada cada vegada que s'esgota */
const spawn = { deck: [], last: -10 };

/** Cada regal surt per un carril diferent de l'anterior (mai dos seguits pel mateix lloc). */
function pickSpawnX(gift) {
  const lanes = CONFIG.SPAWN_LANES;
  if (!spawn.deck.length) {
    spawn.deck = Array.from({ length: lanes }, (_, i) => i).sort(() => Math.random() - 0.5);
  }

  let idx = spawn.deck.findIndex((l) => Math.abs(l - spawn.last) >= 4);
  if (idx < 0) idx = spawn.deck.findIndex((l) => Math.abs(l - spawn.last) >= 2);
  if (idx < 0) idx = 0;
  const lane = spawn.deck.splice(idx, 1)[0];

  spawn.last = lane;
  gift.lane = lane;

  const minX = gift.r + 6;
  const maxX = CONFIG.POSTER_W - gift.r - 6;
  const t = (lane + 0.5) / lanes;
  return clamp(minX + (maxX - minX) * t + rand(-22, 22), minX, maxX);
}

/** Torna a col·locar el regal sota el cartell amb model, mida i posició nous. */
function resetGift(gift, delay = rand(0.05, 0.7)) {
  if (gift.name) templates[gift.name].usage--;
  if (gift.model) {
    gift.pivot.remove(gift.model);
    disposeTintedMaterials(gift.model);
  }

  gift.name = pickModelName();
  templates[gift.name].usage++;
  gift.model = templates[gift.name].object.clone(true);
  tintModel(gift.model, gift);
  gift.pivot.add(gift.model);

  gift.size = Math.round(rand(CONFIG.MIN_SIZE, CONFIG.MAX_SIZE));
  gift.r = gift.size * 0.42;
  gift.depthU.value = clamp((gift.size - CONFIG.MIN_SIZE) / (CONFIG.MAX_SIZE - CONFIG.MIN_SIZE), 0, 1);
  gift.mass = Math.pow(gift.size / 220, 2);
  gift.roll = gift.rollV = gift.pitchV = gift.squash = gift.squashV = 0;
  gift.pitch = CONFIG.TILT_X;
  gift.model.scale.multiplyScalar(gift.size);
  gift.pivot.position.z = gift.size * 0.6 + gift.zJitter; // els grans, al davant

  // Punt de sortida: es reparteix per "carrils" barrejats (com una baralla) i mai s'escull
  // un carril proper a l'últim ni a cap regal que encara és a punt de sortir.
  gift.x = pickSpawnX(gift);
  gift.y = CONFIG.POSTER_H + gift.size * rand(0.6, 1.3); // alçada de sortida lleugerament diferent
  gift.vx = 0;
  gift.riseSpeed = rand(CONFIG.RISE_MIN, CONFIG.RISE_MAX);
  gift.vy = -gift.riseSpeed;
  gift.baseSpin = rand(1.6, 3.0) * (Math.random() < 0.5 ? -1 : 1); // gir inicial, que s'apaga sol
  gift.spin = gift.baseSpin;
  gift.state = "wait";
  gift.t = 0;
  gift.touching = false;
  gift.atCeiling = false;
  gift.lastFx = 0;
  gift.pop = gift.popV = 0;
  gift.delay = delay;
  gift.pivot.visible = false;
}

/* ---------------------------------------------------------
   6. FÍSIQUES (globus)
   --------------------------------------------------------- */

/** Molla amortida: retorna la nova velocitat angular. */
function spring(angle, vel, target, k, c, dt) {
  return vel + (k * (target - angle) - c * vel) * dt;
}

/** Resposta física a un cop: el regal "salta" elàsticament (sense cap brillantor). */
function hitGift(gift, power = 1) {
  gift.popV += 1.5 * clamp(power, 0.3, 1.2);
}

const inactive = (g) => g.state === "wait" || g.state === "gone";

/** Força de flotació, turbulència, parets, sostre i estats (wait → rise → leave → gone). */
function updateGift(gift, dt, time) {
  if (gift.state === "gone") return;
  if (gift.state === "wait") {
    gift.t += dt;
    if (gift.t >= gift.delay) {
      gift.state = "rise";
      gift.pivot.visible = true;
    }
    return;
  }

  // Flotació: la velocitat vertical tendeix cap amunt; fregament lineal + quadràtic (els cops forts frenen més)
  const targetVy = gift.state === "leave" ? -CONFIG.LEAVE_SPEED : -gift.riseSpeed;
  const k = Math.min(1, (CONFIG.AIR_DRAG * dt) / Math.sqrt(gift.mass));
  gift.vy += (targetVy - gift.vy) * k;
  gift.vx += (0 - gift.vx) * Math.min(1, 0.9 * dt);
  const speed = Math.hypot(gift.vx, gift.vy);
  const quad = Math.max(0, 1 - CONFIG.QUAD_DRAG * Math.max(0, speed - gift.riseSpeed) * dt * 60);
  gift.vx *= quad;
  if (gift.vy > 0) gift.vy *= quad;

  // Turbulència suau de l'aire
  gift.vx += (Math.sin(time * 0.7 + gift.seed) * 16 + Math.sin(time * 1.9 + gift.seed * 2) * 9) * dt;
  gift.vy += Math.sin(time * 1.1 + gift.seed * 3) * 7 * dt;
  // El gir té data de caducitat: s'apaga amb un ease-out exponencial fins a quedar quiet
  gift.spin = clamp(gift.spin, -CONFIG.MAX_SPIN, CONFIG.MAX_SPIN) * Math.exp(-CONFIG.SPIN_DECAY * dt);
  if (Math.abs(gift.spin) < 0.015) gift.spin = 0;

  limitSpeed(gift);
  gift.x += gift.vx * dt;
  gift.y += gift.vy * dt;
  gift.yaw += gift.spin * dt;

  // Parets laterals
  if (gift.x < gift.r) hitWall(gift, gift.r, 1);
  if (gift.x > CONFIG.POSTER_W - gift.r) hitWall(gift, CONFIG.POSTER_W - gift.r, -1);

  // Sostre (només mentre omplen): xoca, s'aixafa i es queda pressionat contra ell
  if (gift.y - gift.r > 6) gift.atCeiling = false;
  if (gift.state === "rise" && gift.y - gift.r < 0) {
    gift.y = gift.r;
    const firstTouch = !gift.atCeiling;   // només el primer cop compta; després és pressió en repòs
    gift.atCeiling = true;
    if (firstTouch && gift.vy < -60) {
      const hit = Math.min(1, -gift.vy / 300);
      gift.squashV += Math.min(-gift.vy * 0.03, 14);            // aixafament proporcional al cop
      gift.rollV += rand(-1.4, 1.4) * hit;
      gift.pitchV += 0.8 * hit;
      if (-gift.vy > CONFIG.FX_GIFT_MIN_SPEED && simClock - gift.lastFx > 0.35) {
        hitGift(gift, clamp(-gift.vy / 700, 0.4, 1));
        gift.lastFx = simClock;
      }
    }
    if (gift.vy < 0) gift.vy = -gift.vy * CONFIG.CEILING_BOUNCE;
  }

  // Dinàmica angular: balanceig segons la velocitat lateral, capcineig segons la vertical
  const rollTarget = clamp(-gift.vx * 0.0014, -0.4, 0.4);
  const pitchTarget = CONFIG.TILT_X + clamp((gift.vy + gift.riseSpeed) * 0.0009, -0.3, 0.3);
  gift.rollV = spring(gift.roll, gift.rollV, rollTarget, 55, 5.5, dt);
  gift.pitchV = spring(gift.pitch, gift.pitchV, pitchTarget, 45, 5, dt);
  gift.squashV = spring(gift.squash, gift.squashV, 0, 220, 11, dt);
  gift.popV = spring(gift.pop, gift.popV, 0, 260, 12, dt);
  gift.pop += gift.popV * dt;
  gift.roll += gift.rollV * dt;
  gift.pitch += gift.pitchV * dt;
  gift.squash = clamp(gift.squash + gift.squashV * dt, -0.12, 0.22);

  // Ha sortit del tot per dalt
  if (gift.state === "leave" && gift.y < -gift.size) {
    gift.state = "gone";
    gift.pivot.visible = false;
  }
}

function hitWall(gift, x, dir) {
  const impact = Math.abs(gift.vx);
  gift.x = x;
  gift.vx = dir * impact * CONFIG.WALL_BOUNCE;
  if (impact > 60) {
    gift.squashV += Math.min(impact * 0.012, 8);
    gift.rollV += dir * Math.min(impact * 0.004, 1.5);
  }
}

/* ---------------------------------------------------------
   CICLE: omple → plena → tots marxen → buit → torna a començar
   --------------------------------------------------------- */
function startFill() {
  spawn.deck = [];
  spawn.last = -10;
  gifts.forEach((g, i) => resetGift(g, i * CONFIG.SPAWN_INTERVAL + rand(0, 0.04)));
  cycle.phase = "fill";
  cycle.t = 0;
  cycle.spawnEnd = gifts.length * CONFIG.SPAWN_INTERVAL;
}

/**
 * "SENSE" reacciona al cicle: desapareix lletra a lletra quan el munt de regals el tapa i,
 * en marxar tots, el titular queda llegint-se "CAP INFANT … REGAL". Torna a l'inici de la pausa.
 */
function setSense(gone) {
  poster.dataset.sense = gone ? "gone" : "here";
}

/** Embolcalla cada lletra de "SENSE" en un <span> per poder-les animar una a una. */
function splitSense() {
  const accent = document.querySelector(".headline .accent");
  const text = accent.textContent.trim();
  accent.setAttribute("aria-label", text);
  accent.textContent = "";
  [...text].forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "ch";
    span.textContent = ch;
    span.setAttribute("aria-hidden", "true");
    span.style.setProperty("--i", i);
    span.style.setProperty("--r", `${(i % 2 ? 1 : -1) * (6 + i * 2)}deg`);
    accent.appendChild(span);
  });
  setSense(false);
}

function updateCycle(dt) {
  cycle.t += dt;

  if (cycle.phase === "fill" && cycle.t > CONFIG.SENSE_OUT_AT) setSense(true);

  if (cycle.phase === "fill" && cycle.t > cycle.spawnEnd + CONFIG.FILL_SETTLE) {
    cycle.phase = "full";
    cycle.t = 0;
  } else if (cycle.phase === "full" && cycle.t > CONFIG.FULL_HOLD) {
    // Tots alhora cap amunt
    gifts.forEach((g) => {
      if (g.state === "rise") {
        g.state = "leave";
        g.vy = Math.min(g.vy, -250);
        g.squashV += 3;
      }
    });
    cycle.phase = "release";
    cycle.t = 0;
  } else if (cycle.phase === "release" && gifts.every((g) => g.state === "gone")) {
    cycle.phase = "pause";
    cycle.t = 0;
    setSense(false);
  } else if (cycle.phase === "pause" && cycle.t > CONFIG.PAUSE) {
    startFill();
  }
}

/** El cursor és un cercle que empeny els regals amb la seva velocitat (els pesats cedeixen menys). */
function applyMouse(gift) {
  if (!mouse.active || inactive(gift)) return;

  const dx = gift.x - mouse.x;
  const dy = gift.y - mouse.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const reach = gift.r + CONFIG.CURSOR_RADIUS;
  if (dist >= reach) { gift.touching = false; return; }

  // Primer contacte (amb temps de refredament): línies de còmic al punt de contacte
  const now = simClock;
  if (!gift.touching && now - gift.lastFx > 0.25) {
    const sp = Math.hypot(mouse.vx, mouse.vy);
    hitGift(gift, clamp(0.5 + sp / 1100, 0.5, 1));
    impactFx(
      gift.x - (dx / dist) * gift.r * 0.85,
      gift.y - (dy / dist) * gift.r * 0.85,
      Math.atan2(-dy, -dx),   // l'efecte surt cap al cursor
      clamp(0.5 + sp / 1100, 0.5, 1.3),
      "mouse"
    );
    gift.lastFx = now;
  }
  gift.touching = true;

  let nx = dx / dist;
  let ny = dy / dist;
  const pen = reach - dist;
  const invM = 1 / Math.max(gift.mass, 0.5);

  // Mai cap avall: si el cursor és a sobre, l'empenta es converteix en lateral
  if (ny > 0) {
    ny = 0;
    nx = nx === 0 ? 1 : Math.sign(nx);
  }
  const mvy = Math.min(mouse.vy, 0);

  // separació immediata + impuls proporcional a la velocitat del ratolí
  gift.x += nx * pen * 0.35;
  gift.y += ny * pen * 0.35;
  gift.vx += (nx * pen * 9 + mouse.vx * CONFIG.CURSOR_PUSH * (pen / reach)) * invM;
  gift.vy += (ny * pen * 9 + mvy * CONFIG.CURSOR_PUSH * (pen / reach)) * invM;

  // Cop descentrat → gira (parell = component tangencial de la velocitat del cursor)
  const tangential = mouse.vx * -ny + mvy * nx;
  gift.spin += clamp(tangential * 0.0012, -0.5, 0.5) * invM;
  gift.rollV += clamp(tangential * 0.0016, -1.2, 1.2) * invM;
  gift.squashV += Math.min(Math.hypot(mouse.vx, mouse.vy) * 0.006, 1.2) * (pen / reach);
  limitSpeed(gift);
}

/** Xoc entre regals: separació per massa + rebot amortit; els cops forts treuen efecte. */
function collideGifts() {
  const now = simClock;
  for (let i = 0; i < gifts.length; i++) {
    for (let j = i + 1; j < gifts.length; j++) {
      const a = gifts[i];
      const b = gifts[j];
      if (inactive(a) || inactive(b)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const min = (a.r + b.r) * CONFIG.OVERLAP;
      if (dist >= min) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const ma = a.mass;
      const mb = b.mass;
      const push = min - dist;
      a.x -= nx * push * (mb / (ma + mb)); a.y -= ny * push * (mb / (ma + mb));
      b.x += nx * push * (ma / (ma + mb)); b.y += ny * push * (ma / (ma + mb));

      // Contacte nou o continu? Els efectes i l'aixafament només compten si fa un moment no es tocaven
      const key = i * 100 + j;
      const fresh = now - (pairLast.get(key) ?? -9) > 0.2;
      pairLast.set(key, now);

      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel >= 0) continue;

      const j2 = (-(1 + CONFIG.GIFT_BOUNCE) * rel) / (1 / ma + 1 / mb);
      a.vx -= (j2 / ma) * nx; a.vy -= (j2 / ma) * ny;
      b.vx += (j2 / mb) * nx; b.vy += (j2 / mb) * ny;

      const impact = -rel;
      if (impact > 60 && fresh) {
        // parell i aixafament només si el xoc és de veritat (en el munt, res de tremolors)
        a.spin -= nx * 0.2; b.spin += nx * 0.2;
        a.rollV -= nx * Math.min(impact * 0.004, 1.5); b.rollV -= nx * Math.min(impact * 0.004, 1.5);
        const sq = Math.min(impact * 0.012, 6);
        a.squashV += sq; b.squashV += sq;
      }
      if (fresh && impact > CONFIG.FX_GIFT_MIN_SPEED && now - Math.max(a.lastFx, b.lastFx) > 0.3) {
        // punt de contacte: sobre la vora d'A cap a B
        const p = clamp(impact / 800, 0.4, 1);
        hitGift(a, p);
        hitGift(b, p);
        impactFx(a.x + nx * a.r * 0.95, a.y + ny * a.r * 0.95, Math.atan2(ny, nx), p, "gift");
        a.lastFx = b.lastFx = now;
      }
    }
  }
}

/** Escriu posició, rotació i aixafament als objectes three.js. */
function renderGift(gift, time) {
  // dades per a l'oclusió ambiental dels regals veïns (radi 0 = no compta)
  sphereU.value[gift.index].set(gift.x, CONFIG.POSTER_H - gift.y, gift.pivot.position.z, inactive(gift) ? 0 : gift.r * 0.95);
  const wobble = 0; // sense balanceig residual: en repòs el regal queda quiet
  gift.pivot.position.x = gift.x;
  gift.pivot.position.y = CONFIG.POSTER_H - gift.y;
  gift.pivot.rotation.set(gift.pitch, 0, gift.roll + wobble, "ZXY");
  const pop = 1 + gift.pop;
  gift.pivot.scale.set((1 + gift.squash * 0.5) * pop, (1 - gift.squash) * pop, (1 + gift.squash * 0.5) * pop);

  if (gift.model) gift.model.rotation.y = gift.yaw;
}

/** Un pas de simulació (física + cicle). */
function stepSim(dt, time) {
  simClock += dt;
  updateCycle(dt);
  gifts.forEach((g) => {
    updateGift(g, dt, time);
    applyMouse(g);
  });
  for (let i = 0; i < 3; i++) collideGifts();
  // Mai cap avall: només es tolera un petit rebot
  gifts.forEach((g) => {
    if (g.state === "rise" || g.state === "leave") g.vy = Math.min(g.vy, 120);
  });
}

function loop(now) {
  const time = now / 1000;
  const dt = Math.min(time - lastTime, 0.05); // evita salts en canviar de pestanya
  lastTime = time;

  // el moviment del ratolí s'esmorteeix si deixa de moure's
  mouse.vx *= Math.pow(0.002, dt);
  mouse.vy *= Math.pow(0.002, dt);

  if (!frozen) {
    // sub-passos perquè a gran velocitat els regals no es traspassin
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    for (let i = 0; i < steps; i++) stepSim(dt / steps, time);
    gifts.forEach((g) => renderGift(g, time));
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

/* ---------------------------------------------------------
   7. INTERACCIONS
   --------------------------------------------------------- */
function toPosterCoords(event) {
  const rect = poster.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / scale,
    y: (event.clientY - rect.top) / scale,
  };
}

/* ---------------------------------------------------------
   EFECTE D'IMPACTE: un parell de ratlles senzilles al punt de contacte
   --------------------------------------------------------- */
const SVG_NS = "http://www.w3.org/2000/svg";

function impactFx(x, y, angle, power = 1, kind = "mouse") {
  if (fxActive >= CONFIG.FX_MAX_ACTIVE) return;
  fxActive++;
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("stroke-linecap", "round");
  fx.appendChild(g);
  setTimeout(() => { g.remove(); fxActive--; }, 420);

  const count = kind === "click" ? 6 : 3;
  const fan = kind === "click" ? Math.PI * 2 : 1.3;
  for (let i = 0; i < count; i++) {
    const a = kind === "click"
      ? (i / count) * fan + rand(-0.15, 0.15)
      : angle - fan / 2 + (i / (count - 1)) * fan;
    const r0 = 14 + 6 * power;
    const len = (14 + 8 * power) * rand(0.85, 1.15);
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    [["#0F3D2E", 4]].forEach(([stroke, w]) => {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", x + cos * r0);
      line.setAttribute("y1", y + sin * r0);
      line.setAttribute("x2", x + cos * (r0 + len));
      line.setAttribute("y2", y + sin * (r0 + len));
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", w);
      g.appendChild(line);
      line.animate(
        [
          { transform: "translate(0px, 0px)", opacity: 1 },
          { transform: `translate(${cos * 12}px, ${sin * 12}px)`, opacity: 1, offset: 0.55 },
          { transform: `translate(${cos * 16}px, ${sin * 16}px)`, opacity: 0 },
        ],
        { duration: 340, easing: "ease-out", fill: "forwards" }
      );
    });
  }
}

/** pointermove: posició i velocitat del cursor (en px/s del cartell). */
function handleMove(event) {
  const p = toPosterCoords(event);
  const now = performance.now();
  if (mouse.active) {
    const dt = Math.max((now - mouse.t) / 1000, 0.008);
    mouse.vx = mouse.vx * 0.5 + ((p.x - mouse.x) / dt) * 0.5;
    mouse.vy = mouse.vy * 0.5 + ((p.y - mouse.y) / dt) * 0.5;
  }
  mouse.x = p.x;
  mouse.y = p.y;
  mouse.t = now;
  mouse.active = true;
}

function stopMouse() {
  mouse.active = false;
  mouse.vx = mouse.vy = 0;
}

/** pointerdown: un toc sobre un regal el llença lluny del punt de contacte. */
function handlePoke(event) {
  if (event.target.closest("a")) return;
  const p = toPosterCoords(event);
  mouse.x = p.x; mouse.y = p.y; mouse.active = true; mouse.t = performance.now();

  gifts.forEach((g) => {
    if (inactive(g)) return;
    const dx = g.x - p.x;
    const dy = g.y - p.y;
    const dist = Math.hypot(dx, dy) || 0.001;
    if (dist > g.r + 18) return;
    const invM = 1 / Math.max(g.mass, 0.5);
    hitGift(g, 1.2);
    impactFx(p.x, p.y, Math.atan2(dy, dx), 1.3, "click");
    g.vx += (dx / dist) * CONFIG.CLICK_IMPULSE * invM;
    g.vy += (Math.min(dy / dist, 0) * CONFIG.CLICK_IMPULSE - 60) * invM; // mai cap avall
    g.spin += ((dx / g.r) * 2.2 + rand(-0.6, 0.6)) * invM;
    g.rollV += (dx / g.r) * 2 * invM;
    g.squashV += 4;
    limitSpeed(g);
  });
}

/* ---------------------------------------------------------
   8. ESTAT FINAL PER A LA CAPTURA (tecla Espai)
   --------------------------------------------------------- */
/** Espai: salta a l'instant al moment en què la pantalla és plena i congela'l; un altre cop, reprèn. */
function freezeForCapture() {
  frozen = !frozen;
  startFill();
  if (!frozen) return;

  let t = 0;
  while (cycle.phase !== "full" && t < 30) {
    t += 1 / 60;
    stepSim(1 / 60, t);
  }
  gifts.forEach((g) => renderGift(g, t));
  fx.replaceChildren();
  fxActive = 0;
}

function handleKeys(event) {
  if (event.code === "Space") {
    event.preventDefault();
    freezeForCapture();
  }
}

/* ---------------------------------------------------------
   9. ESCALAT A PANTALLA
   --------------------------------------------------------- */
function fitPoster() {
  scale = Math.min(
    window.innerWidth / CONFIG.POSTER_W,
    window.innerHeight / CONFIG.POSTER_H,
    1
  );
  poster.style.setProperty("--scale", scale);
  if (renderer) {
    renderer.setPixelRatio(clamp((window.devicePixelRatio || 1) * scale, 1.5, 2)); // mínim 1,5: més nítid (supermostreig)
    renderer.setSize(CONFIG.POSTER_W, CONFIG.POSTER_H, false);
  }
}

/* ---------------------------------------------------------
   10. INICI
   --------------------------------------------------------- */
async function init() {
  splitSense();
  setupScene();
  fitPoster();

  poster.addEventListener("pointermove", handleMove);
  poster.addEventListener("pointerdown", handlePoke);
  poster.addEventListener("pointerleave", stopMouse);
  window.addEventListener("resize", fitPoster);
  window.addEventListener("keydown", handleKeys);

  await loadModels();
  if (!Object.keys(templates).length) {
    console.error("Cap model 3D carregat: comprova models/models.js");
    return;
  }

  createStaticGifts();
  for (let i = 0; i < CONFIG.GIFT_COUNT; i++) createGift(i);
  startFill();

  // ?capture a la URL: arrenca directament amb la composició final
  if (new URLSearchParams(window.location.search).has("capture")) freezeForCapture();

  requestAnimationFrame((now) => {
    lastTime = now / 1000;
    requestAnimationFrame(loop);
  });
}

init();
