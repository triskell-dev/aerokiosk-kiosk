/**
 * ScalarOverlay — canvas overlay generique pour couches scalaires sur Leaflet
 * Interpolation bilineaire + palette de couleurs configurable
 */

/* global L */

/**
 * Interpolation bilineaire sur une grille 2D
 * @param {number[]} data - tableau flat ny*nx (row-major, nord→sud)
 * @param {number} nx - nombre de colonnes
 * @param {number} ny - nombre de lignes
 * @param {number} gx - position fractionnaire en X (0..nx-1)
 * @param {number} gy - position fractionnaire en Y (0..ny-1)
 * @returns {number}
 */
function bilinearInterpolate(data, nx, ny, gx, gy) {
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1);
  const fx = gx - x0, fy = gy - y0;
  const v00 = data[y0 * nx + x0];
  const v10 = data[y0 * nx + x1];
  const v01 = data[y1 * nx + x0];
  const v11 = data[y1 * nx + x1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/**
 * Parse une couleur hex (#RRGGBB) ou rgba(r,g,b,a) en {r, g, b, a}
 */
function parseColor(color) {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
  }
  return { r: 0, g: 0, b: 0, a: 0 };
}

class ScalarOverlay {
  /**
   * @param {L.Map} map - instance Leaflet
   * @param {object} options
   * @param {Array<{value: number, color: string}>} options.palette - stops tries par value
   * @param {number} [options.opacity=0.25] - opacite de l'overlay (0-1)
   * @param {number} [options.upscale=8] - facteur d'upscale pour le rendu lisse
   * @param {object} [options.isoLines] - lignes de contour (isobares etc.)
   * @param {number} options.isoLines.interval - intervalle entre les lignes (ex: 5 pour 5 hPa)
   * @param {number} options.isoLines.min - valeur min des lignes
   * @param {number} options.isoLines.max - valeur max des lignes
   * @param {string} [options.isoLines.color='rgba(255,255,255,0.7)'] - couleur des lignes
   * @param {number} [options.isoLines.lineWidth=1.5] - epaisseur des lignes
   * @param {boolean} [options.isoLines.showLabels=true] - afficher les valeurs
   */
  constructor(map, options) {
    this.map = map;
    this.palette = options.palette;
    this.opacity = options.opacity != null ? options.opacity : 0.25;
    this.upscale = options.upscale || 8;
    this.isoLines = options.isoLines || null;
    this.canvas = document.createElement('canvas');
    this.overlay = null;
    this.isoLayerGroup = null;
    this.gridData = null;
    // Pre-parse les couleurs de la palette
    this._parsedPalette = this.palette.map(s => ({
      value: s.value,
      ...parseColor(s.color)
    }));
  }

  /**
   * Fournir les donnees et rendre l'overlay
   * @param {object} gridData - { bounds: {north,south,east,west}, nx, ny, values: number[] }
   */
  setData(gridData) {
    this.gridData = gridData;
    this._render();
  }

  _render() {
    const { nx, ny, values, bounds } = this.gridData;
    const w = nx * this.upscale;
    const h = ny * this.upscale;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    const pixels = imgData.data;
    const globalAlpha = this.opacity;

    for (let py = 0; py < h; py++) {
      const gy = (py / h) * (ny - 1);
      for (let px = 0; px < w; px++) {
        const gx = (px / w) * (nx - 1);
        const val = bilinearInterpolate(values, nx, ny, gx, gy);
        const c = this._valueToColor(val);
        const idx = (py * w + px) * 4;
        pixels[idx] = c.r;
        pixels[idx + 1] = c.g;
        pixels[idx + 2] = c.b;
        pixels[idx + 3] = Math.round(c.a * globalAlpha * 255);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Retirer l'ancien overlay
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
    }
    // Creer un L.imageOverlay a partir du canvas
    this.overlay = L.imageOverlay(
      this.canvas.toDataURL(),
      [[bounds.south, bounds.west], [bounds.north, bounds.east]],
      { opacity: 1, interactive: false, className: 'scalar-overlay' }
    ).addTo(this.map);

    // Isobares en vrais objets Leaflet (polylines + labels nets a tout zoom)
    if (this.isoLines) {
      if (this.isoLayerGroup) this.map.removeLayer(this.isoLayerGroup);
      this.isoLayerGroup = this._buildIsoLayers(values, nx, ny, bounds);
      this.isoLayerGroup.addTo(this.map);
    }
  }

  /**
   * Marching squares → polylines Leaflet + labels divIcon (nets a tout zoom)
   * @returns {L.LayerGroup}
   */
  _buildIsoLayers(values, nx, ny, bounds) {
    const iso = this.isoLines;
    const color = iso.color || 'rgba(255,255,255,0.7)';
    const lineWidth = iso.lineWidth || 1.5;
    const showLabels = iso.showLabels !== false;
    const layers = [];

    // 1) Re-echantillonner sur grille 4x plus fine pour des contours lisses
    const scale = 4;
    const hiNx = (nx - 1) * scale + 1;
    const hiNy = (ny - 1) * scale + 1;
    const hiRes = new Float32Array(hiNx * hiNy);
    for (let j = 0; j < hiNy; j++) {
      const gy = j / scale;
      for (let i = 0; i < hiNx; i++) {
        const gx = i / scale;
        hiRes[j * hiNx + i] = bilinearInterpolate(values, nx, ny, gx, gy);
      }
    }

    // Conversion index hi-res → lat/lon
    const toLat = (j) => bounds.north - (j / (hiNy - 1)) * (bounds.north - bounds.south);
    const toLon = (i) => bounds.west + (i / (hiNx - 1)) * (bounds.east - bounds.west);

    for (let threshold = iso.min; threshold <= iso.max; threshold += iso.interval) {
      // 2) Marching squares sur la grille hi-res (coordonnees en indices hi-res)
      const segments = [];
      for (let j = 0; j < hiNy - 1; j++) {
        for (let i = 0; i < hiNx - 1; i++) {
          const v00 = hiRes[j * hiNx + i];
          const v10 = hiRes[j * hiNx + i + 1];
          const v01 = hiRes[(j + 1) * hiNx + i];
          const v11 = hiRes[(j + 1) * hiNx + i + 1];

          const code = (v00 >= threshold ? 8 : 0)
                     | (v10 >= threshold ? 4 : 0)
                     | (v11 >= threshold ? 2 : 0)
                     | (v01 >= threshold ? 1 : 0);
          if (code === 0 || code === 15) continue;

          const lerp = (a, b) => (a === b) ? 0.5 : (threshold - a) / (b - a);
          const top    = { i: i + lerp(v00, v10), j: j };
          const right  = { i: i + 1,              j: j + lerp(v10, v11) };
          const bottom = { i: i + lerp(v01, v11), j: j + 1 };
          const left   = { i: i,                  j: j + lerp(v00, v01) };

          switch (code) {
            case 1: case 14: segments.push([left, bottom]); break;
            case 2: case 13: segments.push([bottom, right]); break;
            case 3: case 12: segments.push([left, right]); break;
            case 4: case 11: segments.push([top, right]); break;
            case 5: segments.push([left, top], [bottom, right]); break;
            case 6: case 9: segments.push([top, bottom]); break;
            case 7: case 8: segments.push([left, top]); break;
            case 10: segments.push([top, right], [left, bottom]); break;
          }
        }
      }
      if (segments.length === 0) continue;

      // 3) Chainer les segments en polylignes continues
      const polylines = this._chainSegments(segments);

      // 4) Convertir en lat/lon et creer des L.Polyline
      for (const poly of polylines) {
        if (poly.length < 2) continue;
        const latlngs = poly.map(p => [toLat(p.j), toLon(p.i)]);
        layers.push(L.polyline(latlngs, {
          color: color,
          weight: lineWidth,
          opacity: 0.8,
          interactive: false,
          smoothFactor: 1.5
        }));
      }

      // 5) Labels : 1 par polyline longue, au milieu
      if (showLabels) {
        const label = String(Math.round(threshold));
        // Seuil min en degres de distance pour ignorer les courtes polylines
        const minDeg = (bounds.north - bounds.south) * 0.12;

        for (const poly of polylines) {
          const totalLen = this._polylineLenDeg(poly);
          if (totalLen < minDeg) continue;

          const mid = this._pointAlongPolyDeg(poly, totalLen * 0.5);
          if (!mid) continue;

          const latLng = [toLat(mid.j), toLon(mid.i)];
          const icon = L.divIcon({
            className: 'isobar-label',
            html: '<span>' + label + '</span>',
            iconSize: [40, 18],
            iconAnchor: [20, 9]
          });
          layers.push(L.marker(latLng, { icon: icon, interactive: false }));
        }
      }
    }

    return L.layerGroup(layers);
  }

  /**
   * Chainer des segments en polylignes continues (coordonnees i/j)
   */
  _chainSegments(segments) {
    const eps = 0.01;
    const close = (a, b) => Math.abs(a.i - b.i) < eps && Math.abs(a.j - b.j) < eps;
    const used = new Uint8Array(segments.length);
    const polylines = [];

    for (let idx = 0; idx < segments.length; idx++) {
      if (used[idx]) continue;
      used[idx] = 1;
      const poly = [segments[idx][0], segments[idx][1]];

      let changed = true;
      while (changed) {
        changed = false;
        for (let k = 0; k < segments.length; k++) {
          if (used[k]) continue;
          const [a, b] = segments[k];
          const last = poly[poly.length - 1];
          const first = poly[0];
          if (close(last, a)) { poly.push(b); used[k] = 1; changed = true; }
          else if (close(last, b)) { poly.push(a); used[k] = 1; changed = true; }
          else if (close(first, a)) { poly.unshift(b); used[k] = 1; changed = true; }
          else if (close(first, b)) { poly.unshift(a); used[k] = 1; changed = true; }
        }
      }
      polylines.push(poly);
    }
    return polylines;
  }

  /**
   * Longueur totale d'une polyline en unites grille (i/j)
   */
  _polylineLenDeg(poly) {
    let len = 0;
    for (let k = 1; k < poly.length; k++) {
      const di = poly[k].i - poly[k - 1].i;
      const dj = poly[k].j - poly[k - 1].j;
      len += Math.sqrt(di * di + dj * dj);
    }
    return len;
  }

  /**
   * Point a une distance donnee le long de la polyline (coords i/j)
   */
  _pointAlongPolyDeg(poly, dist) {
    let d = 0;
    for (let k = 1; k < poly.length; k++) {
      const di = poly[k].i - poly[k - 1].i;
      const dj = poly[k].j - poly[k - 1].j;
      const segLen = Math.sqrt(di * di + dj * dj);
      if (d + segLen >= dist) {
        const t = (dist - d) / segLen;
        return { i: poly[k - 1].i + t * di, j: poly[k - 1].j + t * dj };
      }
      d += segLen;
    }
    const mid = Math.floor(poly.length / 2);
    return poly[mid];
  }

  /**
   * Interpole lineairement entre les stops de la palette
   */
  _valueToColor(value) {
    const p = this._parsedPalette;
    if (value <= p[0].value) return p[0];
    if (value >= p[p.length - 1].value) return p[p.length - 1];
    for (let i = 0; i < p.length - 1; i++) {
      if (value >= p[i].value && value <= p[i + 1].value) {
        const t = (value - p[i].value) / (p[i + 1].value - p[i].value);
        return {
          r: Math.round(p[i].r + t * (p[i + 1].r - p[i].r)),
          g: Math.round(p[i].g + t * (p[i + 1].g - p[i].g)),
          b: Math.round(p[i].b + t * (p[i + 1].b - p[i].b)),
          a: p[i].a + t * (p[i + 1].a - p[i].a)
        };
      }
    }
    return p[p.length - 1];
  }

  /**
   * Retirer l'overlay de la carte
   */
  remove() {
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
    if (this.isoLayerGroup) {
      this.map.removeLayer(this.isoLayerGroup);
      this.isoLayerGroup = null;
    }
  }
}
