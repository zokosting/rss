function verRegistro() {
  const registro = cargarRegistro();
  const entradas = Object.keys(registro).map(id => Object.assign({ fileId: id }, registro[id]));
  entradas.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  Logger.log(`Total de canciones registradas: ${entradas.length}\n`);

  entradas.forEach((e, i) => {
    Logger.log(
      `#${i + 1}\n` +
      `  Título:        ${e.title}\n` +
      `  Artista:       ${e.artist || '(sin artista)'}\n` +
      `  Nombre en GH:  ${e.githubName || '(no subido)'}\n` +
      `  Nombre Drive:  ${e.driveName || '(no registrado)'}\n` +
      `  Imagen:        ${e.image || '(genérica)'}\n` +
      `  PubDate:       ${e.pubDate}\n` +
      `  Modificado:    ${new Date(e.modified).toISOString()}\n` +
      `  >100 MB:       ${e.tooBig ? 'SÍ (' + (e.size/1024/1024).toFixed(2) + ' MB)' : 'no'}\n` +
      `  FileId:        ${e.fileId}\n` +
      `----------------------------------------`
    );
  });
}
