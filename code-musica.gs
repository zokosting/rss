// ===== CONFIGURACION =====
const FEED_NAME = "Smile Running Man - Hot Shots";
const FEED_DESCRIPTION = "Feed personal de canciones para correr";
const FEED_AUTHOR = "Cello";
const REPO_OWNER = "zokosting";
const REPO_NAME = "rss";
const BRANCH = "main";
const FEED_FILE_PATH = "feed-musica.xml";
const AUDIO_FOLDER_PATH = "Musica";
const COVERS_FOLDER_PATH = "Musica/covers";

const USE_GITHUB_PAGES = true;

const PODCAST_IMAGE_URL = "https://splasradio.com/wp-content/uploads/2026/06/iVoox_Isotipo_negativo.png";

const LIMITE_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVOS_POR_EJECUCION = 2;

// ===== UTILIDADES =====
function construirUrlPublica(pathRelativo) {
  if (USE_GITHUB_PAGES) {
    return `https://${REPO_OWNER}.github.io/${REPO_NAME}/${pathRelativo}`;
  }
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${pathRelativo}`;
}

function apiContentsUrl(pathRelativo) {
  return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${pathRelativo}`;
}

function getGithubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeFileName(titulo) {
  return titulo
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

function getMimeForExt(ext) {
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'flac') return 'audio/flac';
  return 'audio/mpeg';
}

// ===== HELPERS DE BYTES =====
function ubyte(b) { return b & 0xFF; }

function syncsafe(bytes, o) {
  return ((ubyte(bytes[o]) & 0x7F) << 21) |
         ((ubyte(bytes[o+1]) & 0x7F) << 14) |
         ((ubyte(bytes[o+2]) & 0x7F) << 7) |
         (ubyte(bytes[o+3]) & 0x7F);
}

function beInt(bytes, o) {
  return ((ubyte(bytes[o]) << 24) |
          (ubyte(bytes[o+1]) << 16) |
          (ubyte(bytes[o+2]) << 8) |
          ubyte(bytes[o+3])) >>> 0;
}

function leInt(bytes, o) {
  return (ubyte(bytes[o]) |
         (ubyte(bytes[o+1]) << 8) |
         (ubyte(bytes[o+2]) << 16) |
         (ubyte(bytes[o+3]) << 24)) >>> 0;
}

function latin1ToString(bytes, start, end) {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(ubyte(bytes[i]));
  return s;
}

function utf8ToString(bytes, start, end) {
  const arr = [];
  for (let i = start; i < end; i++) arr.push(ubyte(bytes[i]));
  return Utilities.newBlob(arr).getDataAsString('UTF-8');
}

function id3TextDecode(bytes, start, end) {
  if (start >= end) return '';
  const enc = ubyte(bytes[start]);
  const dataStart = start + 1;

  if (enc === 0) {
    let s = '';
    for (let i = dataStart; i < end; i++) {
      const c = ubyte(bytes[i]);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();

  } else if (enc === 3) {
    let stop = end;
    for (let i = dataStart; i < end; i++) {
      if (ubyte(bytes[i]) === 0) { stop = i; break; }
    }
    return utf8ToString(bytes, dataStart, stop).trim();

  } else if (enc === 1 || enc === 2) {
    let offset = dataStart;
    let littleEndian = (enc === 1);
    if (enc === 1 && end - dataStart >= 2) {
      const b0 = ubyte(bytes[dataStart]);
      const b1 = ubyte(bytes[dataStart + 1]);
      if (b0 === 0xFF && b1 === 0xFE) { littleEndian = true;  offset = dataStart + 2; }
      else if (b0 === 0xFE && b1 === 0xFF) { littleEndian = false; offset = dataStart + 2; }
    } else if (enc === 2) {
      littleEndian = false;
    }
    let s = '';
    for (let i = offset; i + 1 < end; i += 2) {
      let code;
      if (littleEndian) code = ubyte(bytes[i]) | (ubyte(bytes[i+1]) << 8);
      else              code = (ubyte(bytes[i]) << 8) | ubyte(bytes[i+1]);
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    return s.trim();
  }
  return '';
}

// ===== LECTURA DE METADATOS (despachador) =====
function leerMetadatos(blob, fileName) {
  const lower = fileName.toLowerCase();
  try {
    if (lower.endsWith('.mp3')) {
      return leerID3v2(blob.getBytes());
    } else if (lower.endsWith('.flac')) {
      return leerFLAC(blob.getBytes());
    } else if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) {
      return leerM4A(blob.getBytes());
    }
  } catch (e) {
    Logger.log(`Error leyendo metadatos de ${fileName}: ${e}`);
  }
  return { title: '', artist: '', albumArtist: '', image: null };
}

// --- ID3v2 (MP3) ---
function leerID3v2(bytes) {
  if (bytes.length < 10) return null;
  if (ubyte(bytes[0]) !== 0x49 || ubyte(bytes[1]) !== 0x44 || ubyte(bytes[2]) !== 0x33) return null;

  const version = ubyte(bytes[3]);
  const flags = ubyte(bytes[5]);
  const size = syncsafe(bytes, 6);

  let pos = 10;
  if (flags & 0x40) {
    const extSize = syncsafe(bytes, pos);
    pos += 4 + extSize;
  }

  const end = Math.min(10 + size, bytes.length);
  let title = '';
  let artist = '';
  let albumArtist = '';
  let image = null;

  while (pos + 10 <= end) {
    const frameId = String.fromCharCode(
      ubyte(bytes[pos]), ubyte(bytes[pos+1]),
      ubyte(bytes[pos+2]), ubyte(bytes[pos+3])
    );
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    const frameSize = (version === 4) ? syncsafe(bytes, pos + 4) : beInt(bytes, pos + 4);
    const dataStart = pos + 10;
    const dataEnd = dataStart + frameSize;
    if (frameSize <= 0 || dataEnd > end) break;

    if (frameId === 'TIT2') {
      title = id3TextDecode(bytes, dataStart, dataEnd);
    } else if (frameId === 'TPE1') {          // Artista de la pista
      artist = id3TextDecode(bytes, dataStart, dataEnd);
    } else if (frameId === 'TPE2') {          // Artista del álbum
      albumArtist = id3TextDecode(bytes, dataStart, dataEnd);
    } else if (frameId === 'APIC') {
      image = parseAPICFrame(bytes, dataStart, dataEnd);
    }

    pos = dataEnd;
  }

  return { title: title, artist: artist, albumArtist: albumArtist, image: image };
}

function parseAPICFrame(bytes, start, end) {
  const enc = ubyte(bytes[start]);
  let p = start + 1;

  const mimeStart = p;
  while (p < end && ubyte(bytes[p]) !== 0) p++;
  const mime = latin1ToString(bytes, mimeStart, p);
  p++;

  p++; // picture type

  if (enc === 0 || enc === 3) {
    while (p < end && ubyte(bytes[p]) !== 0) p++;
    p++;
  } else {
    while (p + 1 < end && !(ubyte(bytes[p]) === 0 && ubyte(bytes[p+1]) === 0)) p += 2;
    p += 2;
  }

  if (p >= end) return null;
  const imgBytes = bytes.slice(p, end);
  return {
    base64: Utilities.base64Encode(imgBytes),
    mime: mime || 'image/jpeg'
  };
}

// --- FLAC ---
function leerFLAC(bytes) {
  const vacio = { title: '', artist: '', albumArtist: '', image: null };
  if (bytes.length < 4) return vacio;
  if (ubyte(bytes[0]) !== 0x66 || ubyte(bytes[1]) !== 0x4C ||
      ubyte(bytes[2]) !== 0x61 || ubyte(bytes[3]) !== 0x43) return vacio;

  let pos = 4;
  let title = '';
  let artist = '';
  let albumArtist = '';
  let image = null;

  while (pos + 4 <= bytes.length) {
    const header = ubyte(bytes[pos]);
    const isLast = (header & 0x80) !== 0;
    const type = header & 0x7F;
    const length = (ubyte(bytes[pos+1]) << 16) | (ubyte(bytes[pos+2]) << 8) | ubyte(bytes[pos+3]);
    const dataStart = pos + 4;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 4) {              // VORBIS_COMMENT
      const vc = parseVorbisComment(bytes, dataStart, dataEnd);
      title = vc.title || '';
      artist = vc.artist || '';
      albumArtist = vc.albumArtist || '';
    } else if (type === 6) {       // PICTURE
      const pic = parseFLACPicture(bytes, dataStart, dataEnd);
      if (pic) image = pic;
    }

    pos = dataEnd;
    if (isLast) break;
  }

  return { title: title, artist: artist, albumArtist: albumArtist, image: image };
}

function parseVorbisComment(bytes, start, end) {
  const result = { title: '', artist: '', albumArtist: '' };
  let pos = start;
  if (pos + 4 > end) return result;

  const vendorLen = leInt(bytes, pos);
  pos += 4 + vendorLen;
  if (pos + 4 > end) return result;

  const count = leInt(bytes, pos);
  pos += 4;

  for (let i = 0; i < count && pos + 4 <= end; i++) {
    const len = leInt(bytes, pos);
    pos += 4;
    if (pos + len > end) break;

    const comment = utf8ToString(bytes, pos, pos + len);
    pos += len;

    const eq = comment.indexOf('=');
    if (eq > 0) {
      const key = comment.substring(0, eq).toUpperCase();
      const val = comment.substring(eq + 1);
      if (key === 'TITLE') result.title = val;
      else if (key === 'ARTIST') result.artist = val;
      else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') result.albumArtist = val;
    }
  }
  return result;
}

function parseFLACPicture(bytes, start, end) {
  let pos = start;
  pos += 4; // picture type

  const mimeLen = leInt(bytes, pos); pos += 4;
  if (pos + mimeLen > end) return null;
  const mime = latin1ToString(bytes, pos, pos + mimeLen);
  pos += mimeLen;

  const descLen = leInt(bytes, pos); pos += 4;
  pos += descLen;

  pos += 16; // width, height, depth, colors

  if (pos + 4 > end) return null;
  const dataLen = leInt(bytes, pos); pos += 4;

  if (pos + dataLen > end) return null;
  const imgBytes = bytes.slice(pos, pos + dataLen);

  return {
    base64: Utilities.base64Encode(imgBytes),
    mime: mime || 'image/jpeg'
  };
}

// --- MP4 / M4A ---
function findBox(bytes, start, end, name) {
  let pos = start;
  while (pos + 8 <= end) {
    const size = beInt(bytes, pos);
    if (size < 8) return null;
    const type = String.fromCharCode(
      ubyte(bytes[pos+4]), ubyte(bytes[pos+5]),
      ubyte(bytes[pos+6]), ubyte(bytes[pos+7])
    );
    if (type === name) {
      return { start: pos + 8, end: pos + size };
    }
    pos += size;
  }
  return null;
}

function leerM4A(bytes) {
  const vacio = { title: '', artist: '', albumArtist: '', image: null };
  if (bytes.length < 12) return vacio;

  const ftyp = String.fromCharCode(
    ubyte(bytes[4]), ubyte(bytes[5]), ubyte(bytes[6]), ubyte(bytes[7])
  );
  if (ftyp !== 'ftyp') return vacio;

  let pos = 0;
  let moov = null;
  while (pos + 8 <= bytes.length) {
    const size = beInt(bytes, pos);
    if (size < 8) break;
    const type = String.fromCharCode(
      ubyte(bytes[pos+4]), ubyte(bytes[pos+5]),
      ubyte(bytes[pos+6]), ubyte(bytes[pos+7])
    );
    if (type === 'moov') {
      moov = { start: pos + 8, end: pos + size };
      break;
    }
    pos += size;
  }
  if (!moov) return vacio;

  let meta = null;
  const udta = findBox(bytes, moov.start, moov.end, 'udta');
  if (udta) {
    meta = findBox(bytes, udta.start, udta.end, 'meta');
  }
  if (!meta) {
    meta = findBox(bytes, moov.start, moov.end, 'meta');
  }
  if (!meta) return vacio;

  const ilst = findBox(bytes, meta.start + 4, meta.end, 'ilst');
  if (!ilst) return vacio;

  let title = '';
  let artist = '';
  let albumArtist = '';
  let image = null;

  let p = ilst.start;
  while (p + 8 <= ilst.end) {
    const size = beInt(bytes, p);
    if (size < 8 || p + size > ilst.end) break;
    const name = String.fromCharCode(
      ubyte(bytes[p+4]), ubyte(bytes[p+5]),
      ubyte(bytes[p+6]), ubyte(bytes[p+7])
    );

    const dataBox = findBox(bytes, p + 8, p + size, 'data');
    if (dataBox) {
      const typeCode = (ubyte(bytes[dataBox.start + 1]) << 16) |
                       (ubyte(bytes[dataBox.start + 2]) << 8)  |
                        ubyte(bytes[dataBox.start + 3]);
      const payloadStart = dataBox.start + 8;
      const payloadEnd = dataBox.end;

      if (name === '\xA9nam') {           // ©nam  = título
        title = utf8ToString(bytes, payloadStart, payloadEnd);
      } else if (name === '\xA9ART') {    // ©ART  = artista
        artist = utf8ToString(bytes, payloadStart, payloadEnd);
      } else if (name === 'aART') {       // aART  = artista del álbum
        albumArtist = utf8ToString(bytes, payloadStart, payloadEnd);
      } else if (name === 'covr') {
        const mime = (typeCode === 14) ? 'image/png' : 'image/jpeg';
        image = {
          base64: Utilities.base64Encode(bytes.slice(payloadStart, payloadEnd)),
          mime: mime
        };
      }
    }
    p += size;
  }

  return { title: title, artist: artist, albumArtist: albumArtist, image: image };
}

// ===== REGISTRO PERSISTENTE =====
// Estructura: { fileId: { driveName, githubName, title, artist, image,
//                          pubDate, modified, ext, tooBig?, size? } }
function cargarRegistro() {
  const raw = PropertiesService.getScriptProperties().getProperty('REGISTRO_CANCIONES');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function guardarRegistro(registro) {
  PropertiesService.getScriptProperties().setProperty(
    'REGISTRO_CANCIONES',
    JSON.stringify(registro)
  );
}

// ===== GITHUB =====
function existeEnGitHub(pathRelativo) {
  const token = getGithubToken();
  const res = UrlFetchApp.fetch(apiContentsUrl(pathRelativo), {
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() === 200) {
    return JSON.parse(res.getContentText('UTF-8'));
  }
  return null;
}

function subirBase64AGitHub(pathRelativo, contentBase64, mensaje) {
  const token = getGithubToken();

  let sha = null;
  const info = existeEnGitHub(pathRelativo);
  if (info) sha = info.sha;

  const payload = {
    message: mensaje,
    content: contentBase64,
    branch: BRANCH
  };
  if (sha) payload.sha = sha;

  const payloadStr = JSON.stringify(payload);

  const res = UrlFetchApp.fetch(apiContentsUrl(pathRelativo), {
    method: "PUT",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: payloadStr,
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    Logger.log(`Error subiendo ${pathRelativo}: ${code} - ${res.getContentText('UTF-8')}`);
    return false;
  }
  return true;
}

function subirBlobAGitHub(blob, pathRelativo, mensaje) {
  let bytes = blob.getBytes();
  let base64 = Utilities.base64Encode(bytes);
  bytes = null;
  const ok = subirBase64AGitHub(pathRelativo, base64, mensaje);
  base64 = null;
  return ok;
}

// ===== SUBE COMO MÁXIMO 1 CANCIÓN NUEVA POR EJECUCIÓN =====
function subirCancionesNuevas() {
  const folder = DriveApp.getRootFolder();
  const files = folder.getFiles();
  const registro = cargarRegistro();

  let procesados = 0;
  let saltados = 0;
  let subidos = 0;
  let demasiadoGrande = 0;

  while (files.hasNext() && procesados < MAX_ARCHIVOS_POR_EJECUCION) {
    let file = files.next();
    const driveName = file.getName();

    if (!driveName.match(/\.(mp3|flac|m4a|wav|mp4)$/i)) {
      file = null;
      continue;
    }

    const id = file.getId();
    const modified = file.getLastUpdated().getTime();
    const entrada = registro[id];

    if (entrada && entrada.driveName === driveName && entrada.modified === modified) {
      saltados++;
      file = null;
      continue;
    }

    // --- Leer metadatos ---
    let blob = file.getBlob();
    const meta = leerMetadatos(blob, driveName);

    const titulo = (meta && meta.title) ? meta.title : driveName.replace(/\.[^/.]+$/, '');

    // Autor: artista de la pista, si no, artista del álbum, si no, vacío
    let autor = '';
    if (meta) {
      if (meta.artist && meta.artist.trim() !== '') autor = meta.artist.trim();
      else if (meta.albumArtist && meta.albumArtist.trim() !== '') autor = meta.albumArtist.trim();
    }

    // Extensión original
    const extMatch = driveName.match(/\.([^.]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';

    const nombreGitHub = sanitizeFileName(titulo) + '.' + ext;

    // --- Comprobar tamaño ---
    const size = file.getSize();
    if (size > LIMITE_BYTES) {
      Logger.log(`Archivo ${driveName} (${(size/1024/1024).toFixed(2)} MB) supera 100 MB. Se registra sin audio.`);

      registro[id] = {
        driveName: driveName,
        githubName: nombreGitHub,
        title: titulo,
        artist: autor,
        image: '',
        pubDate: file.getDateCreated().toUTCString(),
        modified: modified,
        ext: ext,
        tooBig: true,
        size: size
      };
      demasiadoGrande++;
      procesados++;
      blob = null;
      file = null;
      continue;
    }

    // --- Subir audio a GitHub ---
    const audioPath = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;
    const okAudio = subirBlobAGitHub(blob, audioPath, `Audio: ${nombreGitHub}`);
    if (!okAudio) {
      blob = null;
      file = null;
      continue;
    }

    // --- Subir portada si existe ---
    let coverUrl = '';
    if (meta && meta.image && meta.image.base64) {
      let imgExt = 'jpg';
      const mime = (meta.image.mime || '').toLowerCase();
      if (mime.includes('png')) imgExt = 'png';
      else if (mime.includes('gif')) imgExt = 'gif';
      else if (mime.includes('webp')) imgExt = 'webp';

      const coverName = sanitizeFileName(titulo) + '.' + imgExt;
      const coverPath = `${COVERS_FOLDER_PATH}/${coverName}`;
      const okCover = subirBase64AGitHub(coverPath, meta.image.base64, `Cover: ${coverName}`);
      if (okCover) {
        coverUrl = construirUrlPublica(`${COVERS_FOLDER_PATH}/${encodeURIComponent(coverName)}`);
      }
    }

    // --- Registrar ---
    registro[id] = {
      driveName: driveName,
      githubName: nombreGitHub,
      title: titulo,
      artist: autor,
      image: coverUrl,
      pubDate: file.getDateCreated().toUTCString(),
      modified: modified,
      ext: ext
    };
    subidos++;
    procesados++;

    blob = null;
    file = null;
  }

  guardarRegistro(registro);
  Logger.log(
    `Subidos: ${subidos} | Demasiado grandes: ${demasiadoGrande} | ` +
    `Saltados: ${saltados}`
  );
}

// ===== GENERA EL XML DEL FEED =====
function generarXMLFeed() {
  const registro = cargarRegistro();

  const entradas = Object.keys(registro).map(id => Object.assign({ id: id }, registro[id]));
  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  let items = "";
  for (const e of entradas) {
    const imagenItem = (e.image && e.image.trim() !== '') ? e.image : PODCAST_IMAGE_URL;
    const autorItem = (e.artist && e.artist.trim() !== '') ? e.artist : FEED_AUTHOR;
    const ext = e.ext || 'mp3';
    const mime = getMimeForExt(ext);

    let item = `
    <item>
      <title>${escapeXml(e.title)}</title>
      <pubDate>${e.pubDate}</pubDate>
      <guid isPermaLink="false">${e.id}</guid>
      <itunes:author>${escapeXml(autorItem)}</itunes:author>
      <itunes:image href="${imagenItem}" />`;

    if (!e.tooBig) {
      const pathRelativo = `${AUDIO_FOLDER_PATH}/${encodeURIComponent(e.githubName)}`;
      const url = construirUrlPublica(pathRelativo);
      item += `
      <enclosure url="${url}" length="0" type="${mime}" />`;
    }

    item += `
    </item>`;
    items += item;
  }

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${FEED_NAME}</title>
    <description>${FEED_DESCRIPTION}</description>
    <link>https://${REPO_OWNER}.github.io/${REPO_NAME}/</link>
    <language>es</language>
    <itunes:author>${FEED_AUTHOR}</itunes:author>
    <itunes:category text="Music"/>
    <itunes:explicit>no</itunes:explicit>

    <image>
      <url>${PODCAST_IMAGE_URL}</url>
      <title>${FEED_NAME}</title>
      <link>https://${REPO_OWNER}.github.io/${REPO_NAME}/</link>
    </image>
    <itunes:image href="${PODCAST_IMAGE_URL}" />

    ${items}
  </channel>
</rss>`;

  return rss;
}

// ===== SUBE EL FEED A GITHUB (solo si cambió) =====
function subirFeedAGitHub() {
  const contenidoXML = generarXMLFeed();
  const token = getGithubToken();

  const info = existeEnGitHub(FEED_FILE_PATH);
  let sha = null;

  if (info) {
    const actual = UrlFetchApp.fetch(
      `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${FEED_FILE_PATH}?t=${Date.now()}`,
      { muteHttpExceptions: true }
    );
    if (actual.getResponseCode() === 200 &&
        actual.getContentText('UTF-8') === contenidoXML) {
      Logger.log("feed-musica.xml sin cambios. No se sube.");
      return 200;
    }
    sha = info.sha;
  }

  const blob = Utilities.newBlob(contenidoXML, 'text/xml', 'feed-musica.xml');
  let contenidoBase64 = Utilities.base64Encode(blob.getBytes());

  const payload = {
    message: "Actualización automática del feed RSS de música",
    content: contenidoBase64,
    branch: BRANCH
  };
  if (sha) payload.sha = sha;

  const payloadStr = JSON.stringify(payload);
  contenidoBase64 = null;

  const res = UrlFetchApp.fetch(apiContentsUrl(FEED_FILE_PATH), {
    method: "PUT",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: payloadStr,
    muteHttpExceptions: true
  });

  Logger.log("Feed GitHub Response Code: " + res.getResponseCode());
  return res.getResponseCode();
}

// ===== FUNCIÓN PRINCIPAL (trigger) =====
function Actualizar() {
  subirCancionesNuevas();
  subirFeedAGitHub();
}
