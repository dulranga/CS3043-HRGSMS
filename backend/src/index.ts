import express, { Application } from 'express';
import cors from 'cors';
import homeRoutes from './routes/homeRoutes';
import roomRoutes from './routes/roomRoutes';

const app: Application = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.use('/', homeRoutes);
app.use('/rooms', roomRoutes);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
