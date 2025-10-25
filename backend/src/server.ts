import express, { type Express } from 'express';
import bugReportRouter from './routes/bugreport';

// Registers bug report related routes on the provided Express instance.
export const registerBugReportRoute = (app: Express): void => {
  app.use('/api/bugreport', bugReportRouter);
};

// Creates a standalone Express server with the bug report route enabled.
export const createServer = (): Express => {
  const app = express();
  app.use(express.json());
  registerBugReportRoute(app);
  return app;
};

export default createServer;
