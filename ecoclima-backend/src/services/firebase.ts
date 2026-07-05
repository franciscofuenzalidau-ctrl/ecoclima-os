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

export { admin, db };
