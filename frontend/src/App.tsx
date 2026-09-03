import { Routes, Route, Navigate } from 'react-router-dom';

import Landing from './pages/landing';
import Workspace from './pages/Workspace';
import InvarianceAnalysis from './pages/InvarianceAnalysis';
import Login from './pages/Login';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/workspace" element={<Navigate to="/workspace/step/0" replace />} />
      <Route path="/workspace/step/:stepIndex" element={<Workspace />} />
      <Route path="/invariance" element={<InvarianceAnalysis />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;

