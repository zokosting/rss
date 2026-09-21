// ===== ver_registro.gs =====
// Función auxiliar para inspeccionar el registro desde los logs.
// Depende de cargarRegistro(), definida en el archivo principal.

function verRegistro() {
  const registro = cargarRegistro();
  const entradas = Object.keys(registro).map(id => {
    return Object.assign({ fileId: id }, registro[id]);
  });

  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  Logger.log(`Total de audios registrados: ${entradas.length}\n`);

  entradas.forEach((e, i) => {
    Logger.log(
      `#${i + 1}\n` +
      `  Título:        ${e.title}\n` +
      `  Nombre en GH:  ${e.githubName || '(no subido)'}\n` +
      `  Nombre Drive:  ${e.driveName || '(no registrado)'}\n` +
      `  PubDate:       ${e.pubDate}\n` +
      `  Modificado:    ${new Date(e.modified).toISOString()}\n` +
      `  >100 MB:       ${e.tooBig ? 'SÍ (' + (e.size/1024/1024).toFixed(2) + ' MB)' : 'no'}\n` +
      `  FileId:        ${e.fileId}\n` +
      `----------------------------------------`
    );
  });
}
