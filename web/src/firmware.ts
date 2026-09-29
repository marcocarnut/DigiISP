// Installing DigiISP through a board's Micronucleus bootloader, optionally
// upgrading the bootloader to 2.6 first. Used by Bootstrap step 1 and by the
// Devices tab's firmware update.

import { t } from './i18n';
import { digiIspApplication, T85, upgradeApplication } from './images';
import { hex2 } from './avr';
import { Micronucleus, type MicronucleusInfo } from './micronucleus';
import { ask, chooserCancelled, type Checklist } from './ui';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Micronucleus 2.6 or newer? */
export const isCurrentBootloader = (i: MicronucleusInfo) => i.major > 2 || (i.major === 2 && i.minor >= 6);

function describe(m: Micronucleus): string {
  const info = m.info;
  const sig = info.signature ? t('step1.sig', { sig: `1E ${hex2(info.signature[0]).slice(2)} ${hex2(info.signature[1]).slice(2)}` }) : '';
  return t('step1.info', { version: info.version, n: info.flashSize, sig });
}

function checkChip(m: Micronucleus) {
  const s = m.info.signature;
  if (s && (s[0] !== T85.signature[1] || s[1] !== T85.signature[2])) throw new Error(t('err.notT85'));
}

/** Pick the bootloader in the device picker. Null if the picker was closed. */
export async function pickBootloader(): Promise<Micronucleus | null> {
  try {
    return await Micronucleus.request();
  } catch (e) {
    if (chooserCancelled(e)) return null;
    throw e;
  }
}

/**
 * Install DigiISP into the bootloader m (already picked). With upgrade set,
 * an older Micronucleus is first replaced with 2.6: the upgrader is uploaded
 * and run, and the user picks the new bootloader when it comes back (the
 * picker needs a click, which the prompt provides). Returns false if the user
 * cancelled at that point.
 */
export async function installDigiIsp(m: Micronucleus, upgrade: boolean, list: Checklist, bar: HTMLProgressElement): Promise<boolean> {
  list.note(describe(m));
  checkChip(m);
  bar.hidden = false;

  if (upgrade && !isCurrentBootloader(m.info)) {
    const up = m;
    const image = up.prepare(upgradeApplication());
    bar.value = 0;
    await list.run(t('fw.upgrade.erase', { version: up.info.version }), () => up.erase());
    await list.run(t('fw.upgrade.write'), () => up.write(image, (f) => (bar.value = f)));
    await list.run(t('fw.upgrade.run'), async () => {
      await up.run();
      await sleep(2500); // the upgrader rewrites the bootloader and reboots
    });
    const again = await ask(t('fw.upgrade.pickAgain'));
    if (!again) {
      list.note(t('fw.upgrade.later'));
      return false;
    }
    const m2 = await pickBootloader();
    if (!m2) {
      list.note(t('fw.upgrade.later'));
      return false;
    }
    list.note(describe(m2));
    checkChip(m2);
    m = m2;
  }

  const app = digiIspApplication();
  const mn = m;
  const image = mn.prepare(app);
  bar.value = 0;
  await list.run(t('step1.erase'), () => mn.erase());
  await list.run(t('step1.write', { n: app.end }), () => mn.write(image, (f) => (bar.value = f)));
  await list.run(t('step1.start'), () => mn.run());
  return true;
}
