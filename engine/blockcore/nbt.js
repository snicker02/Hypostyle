// blockcore/nbt.js
// Minimal little-endian NBT. Bedrock's .mcstructure is uncompressed LE NBT.
// No dependencies; the reader exists so the validation harness can prove a
// round trip rather than trusting the writer.
//
// Tagged value form used by callers:
//   { type: 'int', value: 3 }
//   { type: 'list', of: 'int', value: [1,2,3] }
//   { type: 'compound', value: { key: taggedValue, ... } }

export const TAG = {
  end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6,
  byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12,
};
const TAG_NAME = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]));

/* ------------------------------ writing ------------------------------ */

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  _need(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  get _view() { return new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength); }
  u8(v) { this._need(1); this.buf[this.len++] = v & 0xff; }
  i16(v) { this._need(2); this._view.setInt16(this.len, v, true); this.len += 2; }
  i32(v) { this._need(4); this._view.setInt32(this.len, v | 0, true); this.len += 4; }
  i64(v) { this._need(8); this._view.setBigInt64(this.len, BigInt(Math.trunc(v)), true); this.len += 8; }
  f32(v) { this._need(4); this._view.setFloat32(this.len, v, true); this.len += 4; }
  f64(v) { this._need(8); this._view.setFloat64(this.len, v, true); this.len += 8; }
  str(s) {
    const bytes = utf8(s);
    this.i16(bytes.length);
    this._need(bytes.length);
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }
  bytes() { return this.buf.slice(0, this.len); }
}

function utf8(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

function fromUtf8(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    else s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
  }
  return s;
}

function writeScalar(w, tag, value) {
  switch (tag) {
    case TAG.byte: w.u8(value); return;
    case TAG.short: w.i16(value); return;
    case TAG.int: w.i32(value); return;
    case TAG.long: w.i64(value); return;
    case TAG.float: w.f32(value); return;
    case TAG.double: w.f64(value); return;
    case TAG.string: w.str(value); return;
    case TAG.byteArray: w.i32(value.length); for (const b of value) w.u8(b); return;
    case TAG.intArray: w.i32(value.length); for (const n of value) w.i32(n); return;
    case TAG.longArray: w.i32(value.length); for (const n of value) w.i64(n); return;
    default: throw new Error(`unwritable tag ${tag}`);
  }
}

function writeValue(w, node) {
  const tag = TAG[node.type];
  if (tag === undefined) throw new Error(`unknown tag name ${node.type}`);
  if (tag === TAG.compound) {
    for (const [name, child] of Object.entries(node.value)) {
      const childTag = TAG[child.type];
      if (childTag === undefined) throw new Error(`unknown tag name ${child.type} at ${name}`);
      w.u8(childTag);
      w.str(name);
      writeValue(w, child);
    }
    w.u8(TAG.end);
    return;
  }
  if (tag === TAG.list) {
    const ofTag = TAG[node.of];
    if (ofTag === undefined) throw new Error(`unknown list element tag ${node.of}`);
    w.u8(ofTag);
    w.i32(node.value.length);
    for (const item of node.value) {
      if (ofTag === TAG.compound || ofTag === TAG.list) writeValue(w, item);
      else writeScalar(w, ofTag, item);
    }
    return;
  }
  writeScalar(w, tag, node.value);
}

/** Serialise a root compound. @returns {Uint8Array} */
export function writeNBT(root, rootName = '') {
  if (root.type !== 'compound') throw new Error('NBT root must be a compound');
  const w = new ByteWriter();
  w.u8(TAG.compound);
  w.str(rootName);
  writeValue(w, root);
  return w.bytes();
}

/* ------------------------------ reading ------------------------------ */

class ByteReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  i64() { const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return Number(v); }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  str() {
    const n = this.i16();
    const s = fromUtf8(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
}

function decode(r, tag) {
  switch (tag) {
    case TAG.byte: return { type: 'byte', value: r.i8() };
    case TAG.short: return { type: 'short', value: r.i16() };
    case TAG.int: return { type: 'int', value: r.i32() };
    case TAG.long: return { type: 'long', value: r.i64() };
    case TAG.float: return { type: 'float', value: r.f32() };
    case TAG.double: return { type: 'double', value: r.f64() };
    case TAG.string: return { type: 'string', value: r.str() };
    case TAG.byteArray: {
      const n = r.i32(); const out = new Int8Array(n);
      for (let i = 0; i < n; i++) out[i] = r.i8();
      return { type: 'byteArray', value: out };
    }
    case TAG.intArray: {
      const n = r.i32(); const out = new Int32Array(n);
      for (let i = 0; i < n; i++) out[i] = r.i32();
      return { type: 'intArray', value: out };
    }
    case TAG.longArray: {
      const n = r.i32(); const out = [];
      for (let i = 0; i < n; i++) out.push(r.i64());
      return { type: 'longArray', value: out };
    }
    case TAG.list: {
      const ofTag = r.u8();
      const n = r.i32();
      const items = [];
      for (let i = 0; i < n; i++) {
        const node = decode(r, ofTag);
        items.push(ofTag === TAG.compound || ofTag === TAG.list ? node : node.value);
      }
      return { type: 'list', of: TAG_NAME[ofTag], value: items };
    }
    case TAG.compound: {
      const value = {};
      for (;;) {
        const childTag = r.u8();
        if (childTag === TAG.end) break;
        const name = r.str();
        value[name] = decode(r, childTag);
      }
      return { type: 'compound', value };
    }
    default: throw new Error(`unreadable tag ${tag}`);
  }
}

/** Parse a root compound written by writeNBT. @returns {{name:string, root:object}} */
export function readNBT(bytes) {
  const r = new ByteReader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const tag = r.u8();
  if (tag !== TAG.compound) throw new Error('not an NBT compound root');
  const name = r.str();
  return { name, root: decode(r, TAG.compound) };
}

/* ------------------------ tagged value helpers ----------------------- */

export const nbt = {
  byte: (v) => ({ type: 'byte', value: v }),
  short: (v) => ({ type: 'short', value: v }),
  int: (v) => ({ type: 'int', value: v | 0 }),
  long: (v) => ({ type: 'long', value: v }),
  float: (v) => ({ type: 'float', value: v }),
  double: (v) => ({ type: 'double', value: v }),
  string: (v) => ({ type: 'string', value: String(v) }),
  list: (of, v) => ({ type: 'list', of, value: v }),
  compound: (v) => ({ type: 'compound', value: v }),
  intList: (v) => ({ type: 'list', of: 'int', value: Array.from(v, (n) => n | 0) }),
};
