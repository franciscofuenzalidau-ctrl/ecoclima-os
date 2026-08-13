import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Check for local credentials for local development
const serviceAccountPath = path.resolve(process.cwd(), 'ecoclima-os-7ca1b-firebase-adminsdk-fbsvc-e1da03103b.json');

if (!admin.apps.length) {
  try {
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('[FIREBASE] Inicializado usando archivo de credenciales local.');
    } else {
      // In Cloud Run environment, the environment variables provide Google Application Default Credentials
      admin.initializeApp();
      console.log('[FIREBASE] Inicializado usando credenciales de entorno (Cloud Run o local no especificado).');
    }
  } catch (error) {
    console.error('Error inicializando Firebase Admin SDK:', error);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

// Firestore rechaza cualquier valor `undefined` y hace fallar la escritura completa.
// Bastaba con que un campo opcional viniera sin valor —por ejemplo la fecha de creación
// de una reserva antigua— para que se cayera el guardado de toda la agenda. Con esto,
// esos campos simplemente no se escriben en vez de tumbar la operación.
if (db) {
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (error) {
    // settings() solo se puede llamar antes de la primera operación; si ya se usó, se ignora.
    console.warn('[FIREBASE] No se pudo aplicar ignoreUndefinedProperties:', (error as Error).message);
  }
}

export { admin, db };
