// ===== CONFIGURACION =====
const FEED_NAME = "Originals Podcast";
const FEED_DESCRIPTION = "Podcasts Originals";
const FEED_AUTHOR = "EREBOR";
const REPO_OWNER = "zokosting";
const REPO_NAME = "rss";
const BRANCH = "main";
const FEED_FILE_PATH = "feed-podcasts.xml";
const AUDIO_FOLDER_PATH = "Podcasts";
const DRIVE_FOLDER_ID = "1R62N1yTogfhx1j0A1B7lOw_bz13z7XiE";

const USE_GITHUB_PAGES = true;
const PODCAST_IMAGE_URL = "https://lh3.googleusercontent.com/d/10qdS-dL2FK4JWCnLfDDmcybsxFrksRqy";

const LIMITE_BYTES = 30 * 1024 * 1024;
const LIMITE_DESCARGA_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVOS_POR_EJECUCION = 1;
const ANTIGUEDAD_MAXIMA_MS = 365 * 24 * 60 * 60 * 1000;

const IA_S3_ENDPOINT = "https://s3.us.archive.org";

// ===== UTILIDADES =====
function construirUrlPublica(pathRelativo) {
  if (USE_GITHUB_PAGES) {
    return `https://${REPO_OWNER}.github.io/${REPO_NAME}/${pathRelativo}`;
  }
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${pathRelativo}`;
}

function apiContentsUrl(pathRelativo) {
  return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodePath(pathRelativo)}`;
}

function getGithubToken() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
}

function getIaAccessKey() {
  return PropertiesService.getScriptProperties().getProperty('IA_ACCESS_KEY');
}

function getIaSecretKey() {
  return PropertiesService.getScriptProperties().getProperty('IA_SECRET_KEY');
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

// Quita tildes y diacríticos (á → a, ñ → n, ü → u...)
function sinTildes(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Codifica cada segmento de una ruta conservando las barras "/"
function encodePath(path) {
  return String(path).split('/').map(encodeURIComponent).join('/');
}

// Nombre de archivo ASCII seguro para Archive.org (sin espacios, tildes ni símbolos)
function nombreArchivoArchive(titulo) {
  const base = sinTildes(titulo)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 150);
  return (base || 'audio') + '.mp3';
}

// ===== CONSTRUIR IDENTIFIER VÁLIDO PARA ARCHIVE.ORG =====
function construirIdentifierArchive(titulo) {
  const prefijo = 'originalspodcast';

  let slug = sinTildes(sanitizeFileName(titulo))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  slug = slug.substring(0, 60).replace(/-+$/g, '');
  if (!slug) slug = 'episodio';

  const timestamp = Date.now();
  const identifier = `${prefijo}-${slug}-${timestamp}`;

  Logger.log(`Identifier generado: ${identifier} (${identifier.length} caracteres)`);
  return identifier;
}

// ===== OBTENER INFORMACIÓN DESDE IVOOX =====
function obtenerInfoIvoox(slug) {
  try {
    const url = `https://www.ivoox.com/${slug}.html`;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;

    const html = res.getContentText('UTF-8');

    let titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (!titleMatch) {
      titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    }
    let title = titleMatch ? titleMatch[1] : slug;

    title = title.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

    const sinSufijoIvoox = title.replace(/\s+[-–—]\s+Podcast en iVoox\s*$/i, '').trim();

    if (sinSufijoIvoox !== title) {
      title = sinSufijoIvoox;

      const partes = title.split(' - ');
      if (partes.length > 1) {
        partes.pop();
        title = partes.join(' - ').trim();
      }
    } else if (title.includes(' - ')) {
      title = title.split(' - ')[0].trim();
    }

    const descMatch = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([\s\S]*?)["']\s*\/?>/i);
    let description = descMatch
      ? descMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
      : '';

    const imgMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    const image = imgMatch ? imgMatch[1] : '';

    return { title: title, description: description, image: image };
  } catch (e) {
    Logger.log(`Error obteniendo info de iVoox para "${slug}": ${e}`);
    return null;
  }
}

// ===== REGISTRO PERSISTENTE =====
function cargarRegistro() {
  const raw = PropertiesService.getScriptProperties().getProperty('REGISTRO_AUDIOS');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function guardarRegistro(registro) {
  PropertiesService.getScriptProperties().setProperty(
    'REGISTRO_AUDIOS',
    JSON.stringify(registro)
  );
}

// ===== COMPRUEBA SI UN ARCHIVO YA EXISTE EN GITHUB =====
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

// ===== SUBE UN BLOB A GITHUB =====
function subirBlobAGitHub(blob, shaExistente, nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;

  let bytes = blob.getBytes();
  let contentBase64 = Utilities.base64Encode(bytes);
  bytes = null;

  const payload = {
    message: `Audio: ${nombreGitHub}`,
    content: contentBase64,
    branch: BRANCH
  };
  if (shaExistente) payload.sha = shaExistente;

  const payloadStr = JSON.stringify(payload);
  contentBase64 = null;

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
    Logger.log(`Error subiendo ${nombreGitHub}: ${code} - ${res.getContentText('UTF-8')}`);
    return false;
  }
  return true;
}

function subirArchivoAGitHub(file, shaExistente, nombreGitHub) {
  return subirBlobAGitHub(file.getBlob(), shaExistente, nombreGitHub);
}

// ===== ELIMINA UN ARCHIVO DE GITHUB =====
function eliminarArchivoDeGitHub(nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;

  const info = existeEnGitHub(pathRelativo);
  if (!info) return true;

  const payload = {
    message: `Eliminación automática (más de un año): ${nombreGitHub}`,
    sha: info.sha,
    branch: BRANCH
  };

  const res = UrlFetchApp.fetch(apiContentsUrl(pathRelativo), {
    method: "DELETE",
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    Logger.log(`Error eliminando ${nombreGitHub} de GitHub: ${code} - ${res.getContentText('UTF-8')}`);
    return false;
  }
  return true;
}

// ===== LISTA LOS ARCHIVOS DE LA CARPETA DE AUDIO EN GITHUB =====
function listarArchivosEnGitHub() {
  const token = getGithubToken();
  const res = UrlFetchApp.fetch(apiContentsUrl(AUDIO_FOLDER_PATH), {
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return [];

  const items = JSON.parse(res.getContentText('UTF-8'));
  if (!Array.isArray(items)) return [];

  return items.filter(i => i.type === 'file');
}

// ===== OBTIENE LA FECHA DEL ÚLTIMO COMMIT DE UN ARCHIVO =====
function obtenerFechaUltimoCommit(nombreGitHub) {
  const token = getGithubToken();
  const pathRelativo = `${AUDIO_FOLDER_PATH}/${nombreGitHub}`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(pathRelativo)}&per_page=1`;

  const res = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return null;

  const commits = JSON.parse(res.getContentText('UTF-8'));
  if (!Array.isArray(commits) || commits.length === 0) return null;

  return new Date(commits[0].commit.committer.date);
}

// ===== LIMPIEZA: ELIMINA ARCHIVOS DE GITHUB CON MÁS DE UN AÑO =====
function limpiarArchivosExpirados() {
  const archivos = listarArchivosEnGitHub();
  const ahora = Date.now();

  let revisados = 0;
  let eliminados = 0;
  let fallidos = 0;

  for (const archivo of archivos) {
    const fecha = obtenerFechaUltimoCommit(archivo.name);

    if (!fecha || isNaN(fecha.getTime())) {
      Logger.log(`No se pudo obtener la fecha de ${archivo.name}. Se omite.`);
      continue;
    }

    revisados++;

    if (ahora - fecha.getTime() > ANTIGUEDAD_MAXIMA_MS) {
      const ok = eliminarArchivoDeGitHub(archivo.name);
      if (ok) {
        eliminados++;
        Logger.log(`Archivo expirado eliminado: ${archivo.name} (último commit: ${fecha.toISOString()})`);
      } else {
        fallidos++;
      }
    }
  }

  Logger.log(`Limpieza: revisados ${revisados}, eliminados ${eliminados}, fallidos ${fallidos}`);
}

// ===== SUBE UN ARCHIVO A ARCHIVE.ORG =====
function subirArchivoAArchive(blob, identifier, filename, metadata) {
  const accessKey = getIaAccessKey();
  const secretKey = getIaSecretKey();

  if (!accessKey || !secretKey) {
    Logger.log('ERROR: No se han configurado las claves IA_ACCESS_KEY y IA_SECRET_KEY.');
    return { ok: false, error: 'Faltan credenciales de Archive.org' };
  }

  const authHeader = `LOW ${accessKey}:${secretKey}`;

  const finalMetadata = Object.assign({
    mediatype: 'audio',
    collection: 'opensource_audio',
    title: 'Originals Podcast - Episodio',
    creator: 'EREBOR',
    noindex: 'true'
  }, metadata);

  const headers = {
    'Authorization': authHeader,
    'x-amz-auto-make-bucket': '1',
    'x-archive-meta-mediatype': finalMetadata.mediatype,
    'x-archive-meta-collection': finalMetadata.collection,
    'x-archive-meta-title': 'uri(' + encodeURIComponent(finalMetadata.title) + ')',
    'x-archive-meta-creator': finalMetadata.creator,
    'x-archive-meta-noindex': finalMetadata.noindex
  };

  const url = `${IA_S3_ENDPOINT}/${identifier}/${encodeURIComponent(filename)}`;
  const options = {
    method: 'PUT',
    headers: headers,
    payload: blob,
    contentType: 'audio/mpeg',
    muteHttpExceptions: true
  };

  try {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();

    if (code === 200 || code === 201) {
      const downloadUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`;
      Logger.log(`Subida a Archive.org exitosa: ${downloadUrl}`);
      return { ok: true, downloadUrl: downloadUrl, identifier: identifier };
    } else {
      Logger.log(`Error al subir a Archive.org (código ${code}): ${res.getContentText()}`);
      return { ok: false, error: `Error ${code}` };
    }
  } catch (e) {
    Logger.log(`Excepción al subir a Archive.org: ${e}`);
    return { ok: false, error: e.toString() };
  }
}

// ===== LEE LA URL DE IVOOX DESDE UN ARCHIVO DE TEXTO =====
function leerUrlDesdeArchivoTexto(file) {
  try {
    const texto = file.getBlob().getDataAsString('UTF-8');
    const regex = /(https?:\/\/www\.ivoox\.com\/[^\s]+)/;
    const match = texto.match(regex);

    if (match) {
      Logger.log(`URL de iVoox encontrada: ${match[1]}`);
      return match[1];
    }
    Logger.log(`No se encontró URL de iVoox en: ${file.getName()}`);
    return null;
  } catch (e) {
    Logger.log(`Error al leer "${file.getName()}": ${e}`);
    return null;
  }
}

// ===== EXTRAE EL SLUG DE UNA URL DE IVOOX =====
function extraerSlugIvoox(url) {
  const match = url.match(/ivoox\.com\/([^\/]+?)\.html/);
  if (match && match[1]) {
    Logger.log(`Slug extraído: ${match[1]}`);
    return match[1];
  }
  Logger.log(`No se pudo extraer el slug de: ${url}`);
  return null;
}

// ===== EXTRAE EL ID NUMÉRICO DE AUDIO =====
// Acepta múltiples patrones:
//  - _rf_123456_ (URL pública de iVoox)
//  - ivoox123456 (nombre de archivo descargado de audio.ivoox.com)
//  - listen_mn_123456_ (URL de descarga directa)
function extraerIdAudioIvoox(texto) {
  if (!texto) return null;

  let match = texto.match(/_rf_(\d+)_/);
  if (match && match[1]) {
    Logger.log(`ID de audio extraído (_rf_): ${match[1]}`);
    return match[1];
  }

  match = texto.match(/ivoox(\d+)(?:\D|$)/i);
  if (match && match[1]) {
    Logger.log(`ID de audio extraído (ivoox): ${match[1]}`);
    return match[1];
  }

  match = texto.match(/listen_mn_(\d+)_/);
  if (match && match[1]) {
    Logger.log(`ID de audio extraído (listen_mn): ${match[1]}`);
    return match[1];
  }

  Logger.log(`No se pudo extraer el ID de audio de: ${texto}`);
  return null;
}

// ===== CONSTRUYE LA URL DE DESCARGA DIRECTA (listen_mn, sin token, permanente) =====
function construirUrlDescarga(idAudio) {
  const url = `https://www.ivoox.com/listen_mn_${idAudio}_1.mp3?pc=`;
  Logger.log(`URL de descarga construida: ${url}`);
  return url;
}

// ===== PROCESA UN ARCHIVO GRANDE (sube a Archive.org) =====
function procesarArchivoGrande(blob, registro, id, modified, nombreGitHub, titulo, descripcion, imagen, pubDate, driveName) {
  Logger.log(`Procesando archivo grande para Archive.org`);

  const identifier = construirIdentifierArchive(titulo);
  const nombreArchive = nombreArchivoArchive(titulo);

  const resultado = subirArchivoAArchive(blob, identifier, nombreArchive, {
    title: titulo,
    creator: 'EREBOR'
  });

  if (!resultado.ok) {
    // No se registra: el audio sigue en Drive sin entrada y se reintentará en la próxima ejecución.
    Logger.log(`No se pudo subir a Archive.org: ${resultado.error}. Se reintentará en la próxima ejecución.`);
    return false;
  }

  registro[id] = {
    driveName: driveName,
    githubName: nombreGitHub,
    title: titulo,
    description: descripcion,
    image: imagen,
    pubDate: pubDate,
    modified: modified,
    archiveUrl: resultado.downloadUrl,
    archiveIdentifier: resultado.identifier,
    archiveFilename: nombreArchive
  };

  Logger.log(`Archivo grande registrado con URL de Archive.org: ${resultado.downloadUrl}`);
  return true;
}

// ===== PROCESA UN ARCHIVO DE TEXTO =====
function procesarArchivoTexto(file, registro, id, modified) {
  Logger.log(`Procesando archivo de texto: ${file.getName()}`);

  const urlPublica = leerUrlDesdeArchivoTexto(file);
  if (!urlPublica) return false;

  const slug = extraerSlugIvoox(urlPublica);
  const idAudio = extraerIdAudioIvoox(urlPublica);
  if (!slug || !idAudio) return false;

  const infoIvoox = obtenerInfoIvoox(slug);
  const titulo = infoIvoox ? infoIvoox.title : slug;
  const descripcion = infoIvoox ? infoIvoox.description : '';
  const imagen = infoIvoox ? infoIvoox.image : '';

  const urlDescarga = construirUrlDescarga(idAudio);
  Logger.log(`Intentando descargar: ${urlDescarga}`);

  let resAudio;
  try {
    resAudio = UrlFetchApp.fetch(urlDescarga, {
      headers: { 'Referer': 'https://www.ivoox.com/' },
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log(`Excepción al descargar: ${e}`);
    Logger.log(`Usando listen_mn como URL externa permanente.`);

    registro[id] = {
      driveName: file.getName(),
      title: titulo,
      description: descripcion,
      image: imagen,
      pubDate: new Date().toUTCString(),
      modified: modified,
      externalUrl: urlDescarga,
      externalUrlSource: 'ivoox-listen_mn'
    };

    try { file.setTrashed(true); Logger.log(`Archivo .txt eliminado: ${file.getName()}`); } catch (e2) {}
    return true;
  }

  if (resAudio.getResponseCode() !== 200) {
    Logger.log(`Error HTTP ${resAudio.getResponseCode()}. Usando listen_mn como URL externa.`);

    registro[id] = {
      driveName: file.getName(),
      title: titulo,
      description: descripcion,
      image: imagen,
      pubDate: new Date().toUTCString(),
      modified: modified,
      externalUrl: urlDescarga,
      externalUrlSource: 'ivoox-listen_mn'
    };

    try { file.setTrashed(true); Logger.log(`Archivo .txt eliminado: ${file.getName()}`); } catch (e2) {}
    return true;
  }

  const audioBlob = resAudio.getBlob();
  const size = audioBlob.getBytes().length;
  const sizeMB = (size / 1024 / 1024).toFixed(2);
  Logger.log(`Audio descargado: ${sizeMB} MB`);

  const nombreDrive = slug + '.mp3';
  audioBlob.setName(nombreDrive);

  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const newFile = folder.createFile(audioBlob);
  const newFileId = newFile.getId();
  Logger.log(`Audio guardado en Drive como: ${nombreDrive} (${newFileId})`);

  try {
    file.setTrashed(true);
    Logger.log(`Archivo .txt eliminado: ${file.getName()}`);
  } catch (e) {
    Logger.log(`Error eliminando el .txt: ${e}`);
  }

  if (size > LIMITE_DESCARGA_BYTES) {
    Logger.log(`Archivo de ${sizeMB} MB guardado en Drive. Queda pendiente para la siguiente ejecución.`);
    return true;
  }

  const nombreGitHub = sanitizeFileName(titulo) + '.mp3';
  const pubDate = newFile.getDateCreated().toUTCString();
  const newModified = newFile.getLastUpdated().getTime();

  if (size > LIMITE_BYTES) {
    Logger.log(`Audio de ${sizeMB} MB (30-50 MB). Enviando a Archive.org...`);
    procesarArchivoGrande(
      audioBlob, registro, newFileId, newModified, nombreGitHub, titulo, descripcion, imagen, pubDate, nombreDrive
    );
  } else {
    let shaExistente = null;
    const infoGitHub = existeEnGitHub(`${AUDIO_FOLDER_PATH}/${nombreGitHub}`);
    if (infoGitHub) shaExistente = infoGitHub.sha;

    const ok = subirBlobAGitHub(audioBlob, shaExistente, nombreGitHub);

    registro[newFileId] = {
      driveName: nombreDrive,
      githubName: nombreGitHub,
      title: titulo,
      description: descripcion,
      image: imagen,
      pubDate: pubDate,
      modified: newModified
    };

    if (ok) Logger.log(`Subido a GitHub: ${nombreGitHub}`);
    else Logger.log(`Fallo al subir a GitHub, pero el audio está en Drive: ${nombreDrive}`);
  }

  return true;
}

// ===== SUBE COMO MÁXIMO 1 ARCHIVO NUEVO POR EJECUCIÓN =====
function subirAudiosNuevosAGitHub() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const files = folder.getFiles();
  const registro = cargarRegistro();

  let procesados = 0;
  let saltados = 0;
  let subidos = 0;
  let demasiadoGrande = 0;
  let txtProcesados = 0;
  let grandesEnDriveEliminados = 0;

  while (files.hasNext() && procesados < MAX_ARCHIVOS_POR_EJECUCION) {
    let file = files.next();
    const driveName = file.getName();
    const mimeType = file.getMimeType();

    const esAudio = mimeType === 'audio/mpeg' || mimeType === 'audio/mp4' || driveName.match(/\.(mp3|m4a|wav)$/i);
    const esTexto = mimeType === 'text/plain' || driveName.match(/\.txt$/i);

    if (!esAudio && !esTexto) {
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

    if (esTexto) {
      const ok = procesarArchivoTexto(file, registro, id, modified);
      if (ok) { txtProcesados++; procesados++; }
      file = null;
      continue;
    }

    // ===== Archivo de audio en Drive =====
    const slug = driveName.replace(/\.[^/.]+$/, "");
    const infoIvoox = obtenerInfoIvoox(slug);

    const titulo = infoIvoox ? infoIvoox.title : slug;
    const descripcion = infoIvoox ? infoIvoox.description : '';
    const imagen = infoIvoox ? infoIvoox.image : '';

    const size = file.getSize();
    const sizeMB = (size / 1024 / 1024).toFixed(2);

    // ===== CASO: archivo en Drive > 50 MB =====
    if (size > LIMITE_DESCARGA_BYTES) {
      Logger.log(`Archivo ${driveName} (${sizeMB} MB) > 50 MB.`);

      // 1. Extraer ID (acepta _rf_, ivoox123, listen_mn_123)
      const idAudio = extraerIdAudioIvoox(slug);

      // 2. Si el slug original no dio metadatos, intentar patrón genérico
      let infoFinal = infoIvoox;
      if (!infoFinal && idAudio) {
        Logger.log(`Reintentando metadatos con patrón genérico para ID ${idAudio}...`);
        infoFinal = obtenerInfoIvoox(`audios-mp3_rf_${idAudio}_1`);
      }

      // 3. Construir título final
      let tituloFinal;
      if (infoFinal && infoFinal.title) {
        tituloFinal = infoFinal.title;
      } else {
        // Fallback: nombre del archivo sin -ivoox{id}, con espacios
        tituloFinal = slug.replace(/-ivoox\d+$/i, '').replace(/[-_]+/g, ' ').trim();
        if (!tituloFinal) tituloFinal = driveName;
        Logger.log(`Usando título desde nombre de archivo: ${tituloFinal}`);
      }

      const descripcionFinal = infoFinal ? infoFinal.description : '';
      const imagenFinal = infoFinal ? infoFinal.image : '';
      const pubDate = file.getDateCreated().toUTCString();

      // 4. Construir URL listen_mn y registrar
      const urlListenMn = idAudio ? construirUrlDescarga(idAudio) : '';

      if (urlListenMn) {
        Logger.log(`URL listen_mn construida: ${urlListenMn}`);
        registro[id] = {
          driveName: driveName,
          title: tituloFinal,
          description: descripcionFinal,
          image: imagenFinal,
          pubDate: pubDate,
          modified: modified,
          externalUrl: urlListenMn,
          externalUrlSource: 'ivoox-listen_mn'
        };
      } else {
        Logger.log(`No se pudo extraer el ID de audio. Se registra como tooBig.`);
        registro[id] = {
          driveName: driveName,
          githubName: sanitizeFileName(tituloFinal) + '.mp3',
          title: tituloFinal,
          description: descripcionFinal,
          image: imagenFinal,
          pubDate: pubDate,
          modified: modified,
          tooBig: true,
          size: size
        };
      }

      try {
        file.setTrashed(true);
        Logger.log(`Archivo eliminado de Drive: ${driveName}`);
      } catch (e) {
        Logger.log(`Error eliminando el archivo de Drive: ${e}`);
      }

      grandesEnDriveEliminados++;
      procesados++;
      file = null;
      continue;
    }

    // ===== Archivos 30-50 MB: Archive.org =====
    const nombreGitHub = sanitizeFileName(titulo) + '.mp3';

    if (size > LIMITE_BYTES) {
      Logger.log(`Archivo ${driveName} (${sizeMB} MB) supera el límite. Enviando a Archive.org...`);

      const ok = procesarArchivoGrande(
        file.getBlob(), registro, id, modified, nombreGitHub, titulo, descripcion, imagen,
        file.getDateCreated().toUTCString(), driveName
      );
      if (ok) { demasiadoGrande++; procesados++; }
      file = null;
      continue;
    }

    // ===== Archivos ≤ 30 MB: GitHub =====
    let shaExistente = null;
    const infoGitHub = existeEnGitHub(`${AUDIO_FOLDER_PATH}/${nombreGitHub}`);
    if (infoGitHub) shaExistente = infoGitHub.sha;

    const ok = subirArchivoAGitHub(file, shaExistente, nombreGitHub);
    if (!ok) { file = null; continue; }

    registro[id] = {
      driveName: driveName,
      githubName: nombreGitHub,
      title: titulo,
      description: descripcion,
      image: imagen,
      pubDate: file.getDateCreated().toUTCString(),
      modified: modified
    };
    subidos++;
    procesados++;

    file = null;
  }

  guardarRegistro(registro);
  Logger.log(
    `Subidos a GitHub: ${subidos} | Archive.org: ${demasiadoGrande} | ` +
    `>50MB eliminados de Drive: ${grandesEnDriveEliminados} | ` +
    `TXT procesados: ${txtProcesados} | Saltados: ${saltados}`
  );
}

// ===== GENERA EL XML DEL FEED =====
function generarXMLFeed() {
  const registro = cargarRegistro();

  const entradas = Object.keys(registro).map(id => {
    return Object.assign({ id: id }, registro[id]);
  });
  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  let items = "";
  for (const e of entradas) {
    const imagenItem = (e.image && e.image.trim() !== '') ? e.image : PODCAST_IMAGE_URL;

    let item = `
    <item>
      <title>${escapeXml(e.title)}</title>
      <pubDate>${e.pubDate}</pubDate>
      <guid isPermaLink="false">${e.id}</guid>
      <itunes:author>${FEED_AUTHOR}</itunes:author>
      <itunes:image href="${escapeXml(imagenItem)}" />`;

    if (e.description && e.description.trim() !== "") {
      item += `
      <description>${escapeXml(e.description)}</description>`;
    } else if (e.tooBig) {
      item += `
      <description>Episodio no alojado por superar el límite de tamaño</description>`;
    }

    let audioUrl = null;

    if (e.externalUrl) {
      audioUrl = e.externalUrl;
    } else if (e.archiveUrl) {
      audioUrl = encodeURI(e.archiveUrl); // las entradas antiguas tienen espacios; las nuevas ya van limpias
    } else if (!e.tooBig && e.githubName) {
      const pathRelativo = `${AUDIO_FOLDER_PATH}/${encodeURIComponent(e.githubName)}`;
      audioUrl = construirUrlPublica(pathRelativo);
    }

    if (audioUrl) {
      item += `
      <enclosure url="${escapeXml(audioUrl)}" length="0" type="audio/mpeg" />`;
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

// ===== SUBE EL FEED A GITHUB =====
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
      Logger.log("feed-podcasts.xml sin cambios. No se sube.");
      return 200;
    }
    sha = info.sha;
  }

  const blob = Utilities.newBlob(contenidoXML, 'text/xml', 'feed-podcasts.xml');
  let contenidoBase64 = Utilities.base64Encode(blob.getBytes());

  const payload = {
    message: "Actualización automática del feed RSS de Podcasts",
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
function EJECUTAR_ACTUALIZAR_TODO() {
  limpiarArchivosExpirados();
  subirAudiosNuevosAGitHub();
  subirFeedAGitHub();
}