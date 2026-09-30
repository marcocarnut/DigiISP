// Download tab: the firmware as files, for people with another programmer.

import { onLang, t } from './i18n';
import { DIGIISP_HEX, FIRMWARE_VERSION, fullImage } from './images';
import { toIntelHex } from './ihex';
import { $ } from './ui';

const APP_FILE = `digiisp-v${FIRMWARE_VERSION}.hex`;
const FULL_FILE = `digiisp-v${FIRMWARE_VERSION}-micronucleus-2.6.hex`;

function save(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function render() {
  $('dl-version').textContent = t('dl.version', { v: FIRMWARE_VERSION });
  $('btn-dl-full').textContent = t('dl.btn', { name: FULL_FILE });
  $('btn-dl-app').textContent = t('dl.btn', { name: APP_FILE });
}

export function initDownload() {
  // Micronucleus + DigiISP, laid out as Install DigiISP step 2 writes them
  $('btn-dl-full').onclick = () => save(FULL_FILE, toIntelHex(fullImage()));
  $('btn-dl-app').onclick = () => save(APP_FILE, DIGIISP_HEX);
  $('dl-full-cmd').textContent =
    `avrdude -c usbasp -p t85 -U flash:w:${FULL_FILE}:i -U lfuse:w:0xe1:m -U hfuse:w:0xdd:m -U efuse:w:0xfe:m`;
  $('dl-app-cmd').textContent = `micronucleus --run ${APP_FILE}`;
  render();
  onLang(render);
}
