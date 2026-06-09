import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { agentLog } from '@/lib/debug-agent-log';

type FirebaseClientConfig = typeof firebaseConfig & { firestoreDatabaseId?: string };

const app = initializeApp(firebaseConfig);
const cfg = firebaseConfig as FirebaseClientConfig;
export const db = cfg.firestoreDatabaseId
  ? getFirestore(app, cfg.firestoreDatabaseId)
  : getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'us-central1');

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const dbInfo = cfg.firestoreDatabaseId ? `db=${cfg.firestoreDatabaseId}` : 'db=(default)';
  console.info(`[firebase] project=${cfg.projectId} ${dbInfo}`);
  // #region agent log
  agentLog(
    'lib/firebase.ts:init',
    'Firebase client init',
    { projectId: cfg.projectId, firestoreDatabaseId: cfg.firestoreDatabaseId ?? '(default)' },
    'H3',
  );
  // #endregion
}
