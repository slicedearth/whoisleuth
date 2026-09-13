/// <reference lib="webworker" />
import { prepareLocalApplicationData, type LocalApplicationPreparation } from '../local-application-preparation.ts';

self.onmessage = async (event: MessageEvent<LocalApplicationPreparation>) => {
  try {
    const result = await prepareLocalApplicationData(event.data);
    const transfer = result.operation === 'encode' ? [result.bytes.buffer]
      : result.operation === 'files' ? result.files.flatMap(file => file ? [file.payload] : []) : [];
    self.postMessage({ kind: 'prepared', result }, { transfer });
  } catch { self.postMessage({ kind: 'error' }); }
};
