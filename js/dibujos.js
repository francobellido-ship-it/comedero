/* ============================================================================
 * dibujos.js — ilustraciones de la app (SVG hechos a mano, sin imágenes externas)
 *  escena(estado): el comedero y el gato según lo que está pasando
 *  anillo(pct, color): indicador circular de nivel
 *  avatar(nombre, collar): círculo con la inicial del gato y su collar
 * ==========================================================================*/
(function (root) {
  'use strict';
  const PIEL = '#EF9F27', PIEL_OSC = '#BA7517', OJO = '#2C2C2A', CROQ = '#9a5b22';
  const gatoCara = (x, y, s, ojos) => `
    <g transform="translate(${x} ${y}) scale(${s})">
      <polygon points="-30,-18 -24,-48 -6,-28" fill="${PIEL}"/><polygon points="30,-18 24,-48 6,-28" fill="${PIEL}"/>
      <polygon points="-25,-24 -22,-40 -12,-29" fill="#F5C4B3"/><polygon points="25,-24 22,-40 12,-29" fill="#F5C4B3"/>
      <ellipse cx="0" cy="0" rx="36" ry="31" fill="${PIEL}"/>
      <path d="M-12 -26 L-8 -16 M0 -29 L0 -18 M12 -26 L8 -16" stroke="${PIEL_OSC}" stroke-width="3" stroke-linecap="round"/>
      ${ojos === 'cerrados' ? `<path d="M-19 0 q6 5 12 0 M7 0 q6 5 12 0" stroke="${OJO}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : ojos === 'tristes' ? `<path d="M-19 2 q6 -5 12 0 M7 2 q6 -5 12 0" stroke="${OJO}" stroke-width="3" fill="none" stroke-linecap="round"/>`
      : `<ellipse cx="-13" cy="-1" rx="5" ry="6.5" fill="${OJO}"/><ellipse cx="13" cy="-1" rx="5" ry="6.5" fill="${OJO}"/><circle cx="-11" cy="-3" r="1.8" fill="#fff"/><circle cx="15" cy="-3" r="1.8" fill="#fff"/>`}
      <path d="M-4 9 L4 9 L0 13 Z" fill="#D4537E"/>
      <path d="M0 13 q-5 6 -10 3 M0 13 q5 6 10 3" stroke="${OJO}" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M-20 10 L-40 6 M-20 14 L-40 16 M20 10 L40 6 M20 14 L40 16" stroke="${OJO}" stroke-width="1.4" opacity=".5"/>
    </g>`;
  // Mecanismo real (vista lateral): rollo de suministro → rodillo A → papel parafinado sobre la
  // plataforma de acrílico (zona de consumo) → rodillo B → raspador → tacho; el papel usado se
  // enrolla en el tubo de recolección. La comida cae y se sirve directo sobre el papel (no hay plato).
  const croquetas = (x, extra) => `<g fill="${CROQ}" ${extra || ''}><circle cx="${x - 10}" cy="99" r="4.2"/><circle cx="${x - 2}" cy="97" r="4.2"/><circle cx="${x + 6}" cy="99" r="4.2"/><circle cx="${x + 1}" cy="93.5" r="4"/><circle cx="${x - 7}" cy="94" r="3.6"/><circle cx="${x + 11}" cy="98.5" r="3.4"/></g>`;
  const meca = (girando, sucio) => `
    <rect x="50" y="104.5" width="160" height="4" rx="1" fill="#85B7EB" opacity=".55"/>
    <path d="M60 129 Q38 124 45 107" stroke="#F1EFE8" stroke-width="2.4" fill="none"/>
    <path d="M215 107 Q222 124 196 130" stroke="${sucio ? '#C9A27A' : '#F1EFE8'}" stroke-width="2.4" fill="none"/>
    <line x1="50" y1="102.5" x2="210" y2="102.5" stroke="#F1EFE8" stroke-width="3"/>
    ${sucio ? '<g fill="#C9A27A" class="avanza"><rect x="150" y="101.5" width="12" height="2" rx="1"/><rect x="176" y="101.5" width="9" height="2" rx="1"/></g>' : ''}
    <g ${girando ? 'class="gira"' : ''}><circle cx="50" cy="108" r="5.5" fill="#D3D1C7"/><line x1="46" y1="108" x2="54" y2="108" stroke="#888780" stroke-width="1.5"/></g>
    <g ${girando ? 'class="gira"' : ''}><circle cx="210" cy="108" r="5.5" fill="#D3D1C7"/><line x1="206" y1="108" x2="214" y2="108" stroke="#888780" stroke-width="1.5"/></g>
    <g ${girando ? 'class="gira"' : ''}><circle cx="68" cy="128" r="9" fill="#F1EFE8" stroke="#D3D1C7"/><circle cx="68" cy="128" r="4" fill="#B4B2A9"/></g>
    <g ${girando ? 'class="gira"' : ''}><circle cx="190" cy="128" r="8" fill="#C9A27A" stroke="#D3D1C7"/><circle cx="190" cy="128" r="3.6" fill="#378ADD"/></g>
    <path d="M216 112 L224 118" stroke="#5F5E5A" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M222 114 L222 138 L254 138 L254 114" fill="#444441" opacity=".45" stroke="#888780" stroke-width="1.5"/>
    <text x="238" y="132" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#B4B2A9">tacho</text>`;
  const tolva = (cayendo) => `<path d="M132 6 L172 6 L162 30 L142 30 Z" fill="#B4B2A9"/><rect x="140" y="30" width="24" height="9" rx="2" fill="#888780"/><rect x="148" y="39" width="8" height="9" fill="#5F5E5A"/>` +
    (cayendo ? `<g fill="${CROQ}" class="caen"><circle cx="150" cy="62" r="4"/><circle cx="155" cy="76" r="4"/><circle cx="151" cy="88" r="3.6"/></g>` : '');
  const ESC = {
    ESPERA: () => meca() + tolva() + gatoCara(70, 60, 0.75, 'cerrados') +
      '<g fill="#5F5E5A" font-family="sans-serif" font-weight="700"><text x="98" y="30" font-size="14" class="flota">z</text><text x="110" y="18" font-size="11" class="flota d2">z</text></g>',
    RECONOCIMIENTO: () => meca() + tolva() + gatoCara(70, 60, 0.75) +
      '<g transform="translate(196 40)"><rect x="-20" y="-13" width="40" height="26" rx="6" fill="#444441"/><circle r="8.5" fill="#85B7EB"/><circle r="3.8" fill="#042C53"/></g>' +
      '<path d="M174 44 Q130 46 104 58" stroke="#85B7EB" stroke-width="3" fill="none" stroke-dasharray="4 5" class="escanea"/>',
    DOSIFICACION: () => meca() + tolva(true) + croquetas(152),
    PRESENTACION: () => meca(true) + tolva() + gatoCara(62, 60, 0.7) + croquetas(112, 'class="acerca"') +
      '<path d="M150 118 L100 118" stroke="#1D9E75" stroke-width="3.5" stroke-linecap="round" marker-end="url(#fl)"/>',
    CONSUMO: () => meca() + tolva() + croquetas(96) + gatoCara(92, 62, 0.72, 'cerrados') +
      '<g fill="#D4537E" class="late"><path d="M196 40 c4-8 14-4 10 4 l-10 10 l-10-10 c-4-8 6-12 10-4z"/></g>',
    RENOVACION: () => meca(true, true) + tolva() +
      `<g fill="${CROQ}" class="renueva"><circle cx="196" cy="98" r="3.6"/><circle cx="203" cy="99" r="3.2"/></g>` +
      '<path d="M90 86 L190 86" stroke="#1D9E75" stroke-width="3.5" stroke-linecap="round" marker-end="url(#fl)" class="avanza"/>' +
      '<text x="62" y="72" font-family="sans-serif" font-size="12" fill="#0F6E56">renovación del papel →</text>',
    MANTENIMIENTO: () => meca() + tolva() + gatoCara(70, 60, 0.75, 'tristes') +
      '<g transform="translate(196 50)"><path d="M0 -24 L24 18 L-24 18 Z" fill="#E24B4A"/><rect x="-2.5" y="-9" width="5" height="15" rx="2" fill="#fff"/><circle cy="12" r="3" fill="#fff"/></g>',
    INICIO: () => meca() + tolva() + '<g transform="translate(90 58)" class="gira"><circle r="18" fill="none" stroke="#888780" stroke-width="7" stroke-dasharray="9 6"/></g>'
  };
  ESC.VERIFICACION = ESC.INICIO;
  root.Dibujos = {
    escena(estado) {
      const f = ESC[estado] || ESC.ESPERA;
      return `<svg viewBox="0 0 260 140" class="escena" role="img" aria-label="Ilustración del comedero"><defs><marker id="fl" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L8 5L1 9" fill="none" stroke="#1D9E75" stroke-width="2"/></marker></defs>${f()}</svg>`;
    },
    anillo(pct, color, centro) {
      const r = 26, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
      return `<svg viewBox="0 0 64 64" class="anillo" aria-hidden="true"><circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--borde)" stroke-width="7"/>` +
        `<circle cx="32" cy="32" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 32 32)"/>` +
        `<text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">${centro}</text></svg>`;
    },
    avatar(nombre, collar, tam) {
      const paleta = ['#EF9F27', '#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD'];
      const nm = String(nombre || '?'); let h = nm.charCodeAt(0) * 7 + nm.length * 3; for (const ch of nm) h += ch.charCodeAt(0);
      const col = { rojo: '#E24B4A', azul: '#378ADD', amarillo: '#EF9F27', verde: '#639922' }[collar];
      const t = tam || 40;
      return `<span class="avatar" style="width:${t}px;height:${t}px;background:${paleta[h % paleta.length]};${col ? `box-shadow:0 0 0 3px var(--sup),0 0 0 6px ${col}` : ''};font-size:${Math.round(t * 0.42)}px">${String(nombre || '?').trim().charAt(0).toUpperCase()}</span>`;
    }
  };
})(window);
