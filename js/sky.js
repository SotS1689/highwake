// Sky dome, sun and stars, the broken cloud deck below, billboard clouds, distant
// mountain-islands on the horizon, and the day/night cycle that drives them all.

import * as THREE from "three";
import { shared, makeNoiseTexture, makePuffTexture, roughen, SHADER_END } from "./gfx.js";
import { mulberry32 } from "./noise.js";

// The cloud deck's shape, shared with the land below so the clouds cast shadows.
// Needs uNoise, uTime and uCover.
export const CLOUD_GLSL = `
    float H(vec2 p, float det){
        vec2 drift = vec2(uTime*0.004, uTime*0.0017);
        float h = texture2D(uNoise, p*0.00008 + drift*0.02).a * 0.5;
        h += texture2D(uNoise, p*0.00027 + drift*0.05).r * 0.32;
        h += texture2D(uNoise, p*0.0009 - drift*0.08).g * 0.14 * det;
        h += texture2D(uNoise, p*0.0031 + drift*0.2).b * 0.05 * det * det;
        return h / (0.82 + 0.14 * det + 0.05 * det * det);
    }
    float cloudCover(vec2 p, float det){ return smoothstep(uCover - 0.03, uCover + 0.04, H(p, det)); }
`;

// Key colours by sun elevation (degrees)
const KEYS = [
    { e: -25, zen: [0.004, 0.008, 0.03], hor: [0.02, 0.04, 0.09], sun: [0.25, 0.35, 0.6], si: 0.35, hemi: 0.35, glow: 1.0, cloudLit: [0.10, 0.13, 0.22], cloudSh: [0.03, 0.05, 0.10] },
    { e: -7, zen: [0.02, 0.03, 0.10], hor: [0.20, 0.12, 0.20], sun: [0.45, 0.35, 0.55], si: 0.4, hemi: 0.4, glow: 0.85, cloudLit: [0.30, 0.22, 0.32], cloudSh: [0.07, 0.07, 0.14] },
    { e: 0, zen: [0.08, 0.13, 0.32], hor: [0.95, 0.45, 0.25], sun: [1.0, 0.45, 0.2], si: 1.2, hemi: 0.55, glow: 0.45, cloudLit: [1.0, 0.55, 0.38], cloudSh: [0.22, 0.18, 0.30] },
    { e: 7, zen: [0.12, 0.25, 0.55], hor: [1.0, 0.70, 0.48], sun: [1.0, 0.72, 0.45], si: 2.4, hemi: 0.8, glow: 0.15, cloudLit: [1.0, 0.82, 0.62], cloudSh: [0.38, 0.38, 0.50] },
    { e: 20, zen: [0.06, 0.24, 0.66], hor: [0.52, 0.70, 0.92], sun: [1.0, 0.92, 0.80], si: 3.0, hemi: 1.0, glow: 0.05, cloudLit: [1.0, 0.97, 0.93], cloudSh: [0.40, 0.48, 0.64] },
    { e: 70, zen: [0.04, 0.20, 0.62], hor: [0.48, 0.68, 0.92], sun: [1.0, 0.97, 0.92], si: 3.3, hemi: 1.05, glow: 0.03, cloudLit: [1.0, 1.0, 1.0], cloudSh: [0.42, 0.50, 0.66] },
];

function sampleKeys(elev) {
    let i = 0;
    while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = Math.min(1, Math.max(0, (elev - a.e) / (b.e - a.e)));
    const mix = (x, y) => x.map((v, k) => v + (y[k] - v) * t);
    const out = {};
    for (const k of Object.keys(a)) out[k] = Array.isArray(a[k]) ? mix(a[k], b[k]) : a[k] + (b[k] - a[k]) * t;
    return out;
}

export class Sky {
    constructor(scene, renderer) {
        this.scene = scene;
        this.noiseTex = makeNoiseTexture(256);
        this.puffTex = makePuffTexture(256);
        this.phase = 0.06;           // 0..1 through the day
        this.mode = "cycle";
        this.dayLength = 24 * 60;    // seconds
        this.aurora = 0;
        this.colors = sampleKeys(30);

        // Lights
        this.sun = new THREE.DirectionalLight(0xffffff, 3);
        this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a70, 1);
        scene.add(this.sun, this.sun.target, this.hemi);
        scene.fog = new THREE.FogExp2(0xb8cce0, 0.00005);

        this._buildDome();
        this._buildSea();
        this._buildClouds();
        this._buildFarIslands();
    }

    // ---- sky dome --------------------------------------------------------------
    _buildDome() {
        this.domeU = {
            uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
            uBelow: { value: new THREE.Color() }, uNight: { value: 0 }, uAurora: { value: 0 }, uSpin: { value: 0 },
            uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uTime: shared.uTime,
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.domeU, side: THREE.BackSide, depthWrite: false, fog: false,
            vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
            fragmentShader: `
                uniform vec3 uZenith, uHorizon, uBelow, uSunDir, uSunColor; uniform float uNight, uAurora, uTime, uSpin;
                varying vec3 vDir;
                float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
                // the ring plane is the planet's equator; we stand at 25 degrees north, one planet radius from its centre
                const vec3 RING_N = vec3(0.0, 0.4226, 0.9063);
                const float RING_H = 0.4226;
                vec3 rot(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v*c + cross(k, v)*s + k*dot(k, v)*(1.0 - c); }
                float vnoise(vec3 p){
                    vec3 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
                    return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                               mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
                }
                float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
                // ring opacity by distance from the planet's centre (in planet radii): belts,
                // fine ringlets that fade out before they alias, and a few gaps
                float ringDensity(float r, float fr){
                    if (r < 1.3 || r > 2.6) return 0.0;
                    float d = (0.55 + 0.25*sin(r*9.0) + 0.2*sin(r*23.0 + 1.3)) * smoothstep(1.3, 1.4, r) * smoothstep(2.6, 2.45, r);
                    float fine = 0.5 + 0.5*sin(r*140.0)*sin(r*61.0 + 2.0);
                    d *= mix(1.0, 0.6 + 0.6*fine, clamp(1.0 - fr*140.0, 0.0, 1.0));
                    d *= 1.0 - (1.0 - smoothstep(0.0, 0.035 + fr, abs(r - 2.05))) * 0.95;
                    d *= 1.0 - (1.0 - smoothstep(0.0, 0.008 + fr, abs(r - 2.33))) * 0.9;
                    d *= mix(0.35, 1.0, smoothstep(1.55, 1.65, r));
                    return clamp(d, 0.0, 1.0);
                }
                vec3 stars(vec3 d, float scale, float thresh, float size){
                    vec3 sp = d*scale, c = floor(sp);
                    float r = hash(c);
                    if (r < thresh) return vec3(0.0);
                    vec3 o = vec3(hash(c+1.3), hash(c+2.7), hash(c+5.1))*0.6 + 0.2;
                    float b = (r - thresh) / (1.0 - thresh);
                    float s = smoothstep(size, 0.0, length(fract(sp) - o));
                    float tw = 0.7 + 0.3*sin(uTime*(1.5 + hash(c+4.4)*3.0) + r*80.0);
                    float tc = hash(c+9.1);
                    vec3 tint = tc < 0.2 ? vec3(1.0, 0.7, 0.45) : tc < 0.5 ? vec3(1.0, 0.92, 0.8) : vec3(0.75, 0.85, 1.0);
                    return tint * s * tw * (0.25 + b*b*2.5);
                }
                vec3 nebula(vec3 d, vec3 c, float w, vec3 c1, vec3 c2, float seed){
                    float m = dot(d, c);
                    if (m < cos(w*2.0)) return vec3(0.0);
                    float an = acos(clamp(m, -1.0, 1.0)), fall = exp(-an*an/(w*w));
                    float f = fbm(d*5.0 + seed), g = fbm(d*11.0 - seed);
                    vec3 col = mix(c1, c2, smoothstep(0.3, 0.7, g));
                    float cloud = smoothstep(0.35, 0.8, f) * fall, fil = smoothstep(0.55, 0.75, g) * fall;
                    float dark = smoothstep(0.55, 0.7, fbm(d*16.0 + seed*2.0)) * fall;
                    return (col*cloud*0.45 + col*fil*0.3) * (1.0 - dark*0.7);
                }
                vec3 galaxy(vec3 d, vec3 c, float size, float tilt, float ang){
                    if (dot(d, c) < 0.0) return vec3(0.0);
                    vec3 a = normalize(cross(c, vec3(0.0, 1.0, 0.0))), b = cross(a, c);
                    vec2 p = vec2(dot(d, a), dot(d, b)) / size;
                    if (dot(p, p) > 9.0) return vec3(0.0);
                    p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p; p.y /= tilt;
                    float r = length(p);
                    float arms = 0.5 + 0.5*sin(2.0*atan(p.y, p.x) - log(r + 0.05)*5.0);
                    return vec3(0.6, 0.65, 0.9)*exp(-r*2.2)*(0.35 + 0.65*arms)*0.35 + vec3(1.0, 0.9, 0.75)*exp(-r*r*40.0)*0.9;
                }
                void main(){
                    vec3 d = normalize(vDir);
                    float h = d.y;
                    vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.,1.), 0.42));
                    col = mix(col, uBelow, smoothstep(0.0, -0.06, h));
                    float sd = max(dot(d, uSunDir), 0.);
                    float up = smoothstep(-0.12, 0.05, uSunDir.y);
                    col += uSunColor * (pow(sd, 5.)*0.28 + pow(sd, 48.)*0.55) * up;
                    col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 30. * up;
                    float md = max(dot(d, -uSunDir), 0.);
                    col += vec3(0.85,0.9,1.0) * (smoothstep(0.99975, 0.99985, md)*4. + pow(md, 200.)*0.25) * uNight;
                    if (uNight > 0.01 && h > -0.02) {
                        // a darker sky overhead so the stars stand out
                        col *= 1.0 - 0.4 * uNight * smoothstep(0.0, 0.5, h);
                        // the starfield turns slowly about the planet's axis through the night
                        vec3 sd3 = rot(d, RING_N, -uSpin);
                        float hor = smoothstep(-0.02, 0.15, h);
                        // the galaxy we live in: a band of glow with dark dust lanes and a bright core
                        vec3 G = normalize(vec3(0.3, 0.2, 0.9));
                        float gl = dot(sd3, G);
                        float band = exp(-gl * gl * 14.0);
                        float sky = 0.0;
                        if (band > 0.02) {
                            float f = fbm(sd3 * 4.0);
                            float dust = smoothstep(0.48, 0.68, fbm(sd3 * 9.0 + 3.0)) * exp(-gl * gl * 60.0);
                            float core = pow(max(dot(sd3, normalize(vec3(-0.85, 0.45, 0.2))), 0.0), 6.0);
                            sky = band * (0.35 + f * 0.9) * (1.0 - dust * 0.85);
                            col += mix(vec3(0.11, 0.1, 0.2), vec3(0.42, 0.32, 0.24), core) * sky * (1.0 + core * 2.5) * uNight * hor;
                        }
                        // nebulae: glowing clouds of hydrogen red, oxygen teal and violet
                        col += nebula(sd3, normalize(vec3(-0.6, 0.55, 0.35)), 0.35, vec3(0.75, 0.12, 0.32), vec3(0.15, 0.55, 0.65), 1.0) * uNight * hor;
                        col += nebula(sd3, normalize(vec3(0.5, 0.7, -0.45)), 0.28, vec3(0.2, 0.5, 0.75), vec3(0.55, 0.2, 0.7), 7.0) * uNight * hor;
                        col += nebula(sd3, normalize(vec3(0.85, 0.3, 0.4)), 0.22, vec3(0.8, 0.3, 0.15), vec3(0.65, 0.15, 0.4), 13.0) * uNight * hor;
                        // other galaxies, small spirals and ellipses far away
                        col += galaxy(sd3, normalize(vec3(-0.2, 0.8, -0.55)), 0.05, 0.45, 0.7) * uNight * hor;
                        col += galaxy(sd3, normalize(vec3(0.7, 0.55, 0.45)), 0.03, 0.8, 2.1) * uNight * hor;
                        col += galaxy(sd3, normalize(vec3(-0.75, 0.35, -0.55)), 0.022, 0.3, 4.0) * uNight * hor;
                        col += galaxy(sd3, normalize(vec3(0.1, 0.95, 0.3)), 0.016, 0.6, 5.5) * uNight * hor;
                        // stars: a dense faint layer, thicker along the galaxy, and a sparse bright one
                        vec3 st = stars(sd3, 360.0, 0.93 - band * 0.12, 0.2) * 1.3 + stars(sd3, 150.0, 0.982, 0.16) * 3.0;
                        col += st * uNight * hor;
                    }
                    // the planet's rings, an arch across the southern sky, lit by the sun
                    // and cut by the planet's shadow at night
                    if (h > -0.01) {
                        float dn = dot(d, RING_N);
                        float t = -RING_H / dn;
                        if (dn < 0.0 && t > 0.0) {
                            vec3 P = vec3(0.0, 1.0, 0.0) + d * t;
                            float r = length(P);
                            float fr = fwidth(r);
                            float dens = ringDensity(r, fr);
                            if (dens > 0.001) {
                                vec3 rc = mix(vec3(1.0, 0.68, 0.36), vec3(0.5, 0.78, 1.0), smoothstep(1.9, 2.3, r));
                                rc = mix(rc, vec3(1.0, 0.45, 0.5), smoothstep(1.45, 1.5, r) * smoothstep(1.62, 1.55, r));
                                rc = mix(rc, vec3(0.6, 1.0, 0.85), smoothstep(2.12, 2.16, r) * smoothstep(2.26, 2.2, r) * 0.6);
                                // by day, a touch brighter where sunlight scatters forward through the ice;
                                // by night, evenly lit along the whole arch
                                float fwd = pow(max(dot(d, uSunDir), 0.0), 8.0) * 1.5 * (1.0 - uNight);
                                float a = dens * smoothstep(-0.01, 0.1, h);
                                vec3 ringDay = mix(col, vec3(1.0), 0.6) * (0.9 + fwd * 0.4);
                                col = mix(col, ringDay, a * 0.32 * (1.0 - uNight));
                                col = mix(col, col * 0.35, a * uNight);
                                col += rc * 1.4 * a * uNight;
                            }
                        }
                    }
                    if (uAurora > 0.01 && h > 0.0) {
                        float a = 0.;
                        for (int i=0;i<3;i++){
                            float fi = float(i);
                            float w = sin(d.x*5. + uTime*0.07*(fi+1.) + sin(d.z*3.+uTime*0.11+fi)*2.2);
                            a += smoothstep(0.75, 1.0, w) * smoothstep(0.08, 0.35, h) * smoothstep(0.8, 0.35, h);
                        }
                        col += mix(vec3(0.1,1.0,0.6), vec3(0.6,0.3,1.0), clamp(h*2.,0.,1.)) * a * uAurora * 0.55;
                    }
                    gl_FragColor = vec4(col, 1.);
                    ${SHADER_END}
                }`,
        });
        this.dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
        this.dome.frustumCulled = false;
        this.dome.renderOrder = -10;
        this.scene.add(this.dome);
    }

    // ---- the sea of clouds -------------------------------------------------------
    _buildSea() {
        this.seaU = {
            uNoise: { value: this.noiseTex }, uTime: shared.uTime, uSunDir: shared.uSunDir,
            uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uFar: { value: new THREE.Color() },
            uCam: { value: new THREE.Vector3() }, uSunColor: shared.uSunColor, uCover: { value: 0.555 },
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.seaU, fog: false, transparent: true, depthWrite: false,
            vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
            fragmentShader: `
                uniform sampler2D uNoise; uniform float uTime, uCover; uniform vec3 uSunDir, uLit, uShade, uFar, uCam, uSunColor;
                varying vec3 vW;
                ${CLOUD_GLSL}
                void main(){
                    vec2 p = vW.xz;
                    float dist = length(vW - uCam);
                    float det = 1.0 - smoothstep(1500., 14000., dist);
                    float e = 40.0 + dist*0.006;
                    float h = H(p, det);
                    float hx = H(p + vec2(e,0.), det), hz = H(p + vec2(0.,e), det);
                    vec3 n = normalize(vec3((h-hx)/e*2600., 1.0, (h-hz)/e*2600.));
                    float sunUp = max(uSunDir.y, 0.0);
                    vec3 L = normalize(uSunDir + vec3(0.,0.12,0.));
                    float dif = clamp(dot(n, L)*0.5 + 0.5, 0., 1.);
                    float cover = smoothstep(uCover - 0.03, uCover + 0.04, h);
                    if (cover < 0.004) discard;
                    float billow = smoothstep(uCover, uCover + 0.3, h);
                    vec3 col = mix(uShade, uLit, clamp(pow(dif, 1.6)*0.8 + billow*0.35 - 0.1, 0., 1.));
                    vec3 v = normalize(uCam - vW);
                    col += uSunColor * pow(max(dot(reflect(-v, n), uSunDir), 0.), 12.) * 0.12 * sunUp;
                    float fogF = 1.0 - exp(-dist*0.000042);
                    col = mix(col, uFar, clamp(fogF, 0., 1.));
                    // thin edges of the cloud deck are darker underneath and see-through
                    col *= 0.8 + 0.2 * cover;
                    gl_FragColor = vec4(col, cover);
                    ${SHADER_END}
                }`,
        });
        this.sea = new THREE.Mesh(new THREE.PlaneGeometry(240000, 240000, 1, 1).rotateX(-Math.PI / 2), mat);
        this.sea.position.y = -20;
        this.sea.frustumCulled = false;
        this.sea.renderOrder = -5;
        this.scene.add(this.sea);
    }

    // ---- billboard clouds (instanced) -------------------------------------------
    _buildClouds() {
        const rand = mulberry32(5150);
        this.cloudList = [];
        // low layer hugging the sea
        for (let i = 0; i < 170; i++) {
            const a = rand() * Math.PI * 2, d = rand() * 16000;
            this.cloudList.push({ p: [Math.cos(a) * d, 60 + rand() * 380, Math.sin(a) * d], s: 500 + rand() * 900, a: 0.7, tint: 0 });
        }
        // scattered mid-level clouds drifting among the islands
        for (let i = 0; i < 160; i++) {
            const a = rand() * Math.PI * 2, d = 1500 + rand() * 13000;
            const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 900 + rand() * 3600;
            const n = 3 + Math.floor(rand() * 5);
            for (let k = 0; k < n; k++) {
                this.cloudList.push({ p: [cx + (rand() - 0.5) * 500, cy + (rand() - 0.5) * 90, cz + (rand() - 0.5) * 500], s: 160 + rand() * 260, a: 0.55 + rand() * 0.3, tint: 0 });
            }
        }
        this.cloudMat = this._cloudMaterial();
        this.layers = [];
    }

    // Main cloud layer; call after waterfalls etc. have added their mist
    finishClouds() {
        this.main = this.makeLayer(this.cloudList, this.scene);
    }

    addCloud(p, s, a = 0.7, tint = 0) {
        this.cloudList.push({ p, s, a, tint });
    }

    _cloudMaterial(flash = { value: 0 }) {
        const u = {
            uPuff: { value: this.puffTex }, uLit: this.seaU.uLit, uShade: this.seaU.uShade, uFar: this.seaU.uFar,
            uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uCam: this.seaU.uCam, uTime: shared.uTime, uFlash: flash,
        };
        return new THREE.ShaderMaterial({
            uniforms: u, transparent: true, depthWrite: false, fog: false,
            vertexShader: `
                attribute vec3 aOffset; attribute vec4 aParams;
                varying vec2 vUv; varying float vA; varying float vDist; varying float vTint; varying vec3 vW;
                void main(){
                    vUv = uv;
                    vec4 w = modelMatrix * vec4(aOffset, 1.);
                    vec4 mv = viewMatrix * w;
                    float rot = aParams.w;
                    vec2 q = position.xy * aParams.x;
                    q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * q;
                    mv.xy += q * vec2(1.0, 0.62);
                    vDist = length(mv.xyz);
                    vA = aParams.y; vTint = aParams.z; vW = w.xyz;
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform sampler2D uPuff; uniform vec3 uLit, uShade, uFar, uSunDir, uSunColor, uCam; uniform float uFlash;
                varying vec2 vUv; varying float vA; varying float vDist; varying float vTint; varying vec3 vW;
                void main(){
                    float a = texture2D(uPuff, vUv).a;
                    if (a < 0.01) discard;
                    vec3 v = normalize(vW - uCam);
                    float fwd = pow(max(dot(v, uSunDir), 0.), 6.);
                    float topLit = clamp(vUv.y*0.9 + 0.25, 0., 1.);
                    vec3 col = mix(uShade, uLit, topLit*0.8 + 0.2*max(uSunDir.y,0.));
                    col += uSunColor * fwd * (1.0 - a) * 0.9;
                    col = mix(col, col*vec3(0.16,0.18,0.26) + vec3(0.02,0.02,0.04), vTint);
                    col += vec3(0.75,0.8,1.0) * uFlash * vTint * a * 2.5;
                    float fogF = 1.0 - exp(-vDist*0.00005);
                    col = mix(col, uFar, clamp(fogF,0.,1.));
                    float near = smoothstep(30., 260., vDist);
                    gl_FragColor = vec4(col, a * vA * near);
                    ${SHADER_END}
                }`,
        });
    }

    // An instanced set of billboards under `parent`, re-sorted back to front now and then
    makeLayer(list, parent, flash) {
        const N = list.length;
        const geo = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        geo.index = quad.index;
        geo.setAttribute("position", quad.attributes.position);
        geo.setAttribute("uv", quad.attributes.uv);
        const off = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
        const par = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
        off.setUsage(THREE.DynamicDrawUsage);
        par.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute("aOffset", off);
        geo.setAttribute("aParams", par);
        geo.instanceCount = N;
        const mesh = new THREE.Mesh(geo, flash ? this._cloudMaterial(flash) : this.cloudMat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        parent.add(mesh);
        const order = list.map((_, i) => i);
        const local = new THREE.Vector3();
        const layer = {
            mesh, timer: 0,
            write(cam) {
                local.copy(cam);
                mesh.worldToLocal(local);
                const dist = list.map((c) => (c.p[0] - local.x) ** 2 + (c.p[1] - local.y) ** 2 + (c.p[2] - local.z) ** 2);
                order.sort((a, b) => dist[b] - dist[a]);
                const O = off.array, P = par.array;
                for (let i = 0; i < N; i++) {
                    const c = list[order[i]];
                    O[i * 3] = c.p[0]; O[i * 3 + 1] = c.p[1]; O[i * 3 + 2] = c.p[2];
                    P[i * 4] = c.s; P[i * 4 + 1] = c.a; P[i * 4 + 2] = c.tint; P[i * 4 + 3] = (order[i] * 2.39996) % 6.28;
                }
                off.needsUpdate = true;
                par.needsUpdate = true;
            },
        };
        layer.write(new THREE.Vector3());
        this.layers.push(layer);
        return layer;
    }

    // ---- distant giants on the horizon (scale cue) -----------------------------------
    _buildFarIslands() {
        const rand = mulberry32(31337);
        this.far = new THREE.Group();
        this.farU = { uCol: { value: new THREE.Color() }, uLit: { value: new THREE.Color() }, uSunDir: shared.uSunDir };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.farU, fog: false,
            vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
            fragmentShader: `uniform vec3 uCol, uLit, uSunDir; varying vec3 vN;
                void main(){ float l = clamp(dot(vN, uSunDir)*0.5+0.5, 0., 1.); vec3 c = mix(uCol, uLit, l*0.55 + max(vN.y,0.)*0.15); gl_FragColor = vec4(c,1.); ${SHADER_END} }`,
        });
        this.farMat = mat;
        this.scene.add(this.far);
    }

    // Giant islands on the far horizon, made from the real island shapes scaled way up
    setFarGeometries(geos) {
        const rand = mulberry32(31337);
        for (let i = 0; i < 16; i++) {
            const { geo, r } = geos[i % geos.length];
            const m = new THREE.Mesh(geo, this.farMat);
            const a = (i / 16) * Math.PI * 2 + rand() * 0.25;
            const d = 40000 + rand() * 20000;
            const s = (2200 + rand() * 3200) / r;
            m.position.set(Math.cos(a) * d, 1500 + rand() * 9000, Math.sin(a) * d);
            m.scale.set(s, s * (0.9 + rand() * 0.5), s);
            m.rotation.y = rand() * 6.28;
            m.renderOrder = -4;
            this.far.add(m);
        }
    }

    setMode(mode) { this.mode = mode; }

    sunElevation() {
        switch (this.mode) {
            case "day": return 48;
            case "golden": return 6;
            case "night": return -24;
            default: return 18 + 40 * Math.sin(this.phase * Math.PI * 2);
        }
    }

    update(dt, camera) {
        this.phase = (this.phase + dt / this.dayLength) % 1;
        const elev = this.sunElevation();
        const az = this.mode === "cycle" ? this.phase * Math.PI * 2 + 0.9 : 2.3;
        const er = (elev * Math.PI) / 180;
        const sunDir = new THREE.Vector3(Math.cos(er) * Math.cos(az), Math.sin(er), Math.cos(er) * Math.sin(az)).normalize();
        shared.uSunDir.value.copy(sunDir);
        const c = (this.colors = sampleKeys(elev));
        const night = Math.min(1, Math.max(0, (-elev - 2) / 14));
        shared.uSunColor.value.setRGB(...c.sun);
        shared.uGlow.value = c.glow;
        this.domeU.uZenith.value.setRGB(...c.zen);
        this.domeU.uHorizon.value.setRGB(...c.hor);
        this.domeU.uNight.value = night;
        this.domeU.uSpin.value = this.phase * Math.PI * 2;
        this.domeU.uAurora.value = Math.max(this.aurora * (0.35 + night), 0);

        // light from the sun, or the moon at night
        const lightDir = elev > -4 ? sunDir : sunDir.clone().negate();
        this.sun.position.copy(camera.position).addScaledVector(lightDir, 5000);
        this.sun.target.position.copy(camera.position);
        this.sun.color.setRGB(...c.sun);
        this.sun.intensity = c.si;
        this.hemi.color.setRGB(c.zen[0] * 2 + 0.25, c.zen[1] * 2 + 0.25, c.zen[2] * 1.6 + 0.3);
        this.hemi.groundColor.setRGB(...c.cloudLit.map((v, k) => v * 0.45 + c.cloudSh[k] * 0.35));
        this.hemi.intensity = c.hemi;

        // haze: horizon colour, warmer when looking toward the sun
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const toward = Math.max(0, fwd.dot(sunDir));
        const haze = new THREE.Color().setRGB(...c.hor).lerp(new THREE.Color().setRGB(...c.sun).multiplyScalar(0.9), toward * 0.25 * (1 - night));
        this.scene.fog.color.copy(haze);
        shared.uHaze.value.copy(haze);
        this.domeU.uBelow.value.setRGB(...c.cloudLit.map((v, k) => v * 0.55 + c.hor[k] * 0.45));
        this.seaU.uLit.value.setRGB(...c.cloudLit);
        this.seaU.uShade.value.setRGB(...c.cloudSh);
        this.seaU.uFar.value.copy(this.domeU.uBelow.value);
        this.seaU.uCam.value.copy(camera.position);

        this.farU.uCol.value.setRGB(...c.hor.map((v, k) => v * 0.62 + c.zen[k] * 0.3));
        this.farU.uLit.value.setRGB(...c.hor.map((v, k) => v * 0.8 + c.zen[k] * 0.15 + c.sun[k] * 0.05));

        this.dome.position.copy(camera.position);
        this.dome.scale.setScalar(camera.far * 0.9);
        this.sea.position.x = camera.position.x;
        this.sea.position.z = camera.position.z;
        this.far.position.set(camera.position.x * 0.6, 0, camera.position.z * 0.6);

        for (const l of this.layers) {
            l.timer -= dt;
            if (l.timer <= 0) { l.timer = 0.35; l.write(camera.position); }
        }
        return { elev, night };
    }
}
