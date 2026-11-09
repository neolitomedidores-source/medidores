// Pega aquí la URL de la aplicación web de Apps Script (termina en /exec).
window.API_URL = 'https://script.google.com/macros/s/AKfycbyC_LO8RjSXIjsBqVMi04tJypz_GPu2mivRFcCRkjXT_j1MaYl7J1rtgyhtXYBzn3EPdw/exec';

// Qué número de medidor se escribe en el pizarrón (NDM) en cada foto:
//   'actual' = medidor retirado (viejo)   'nuevo' = medidor instalado
window.NDM_PIZARRON = { antes: 'actual', despues: 'nuevo' };

// Tamaño máximo de las fotos que se suben (lado mayor, en pixeles). 0 = subir la foto original sin cambios.
window.FOTO_MAX_PX = 2560;
