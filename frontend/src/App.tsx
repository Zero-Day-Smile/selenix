import React, { useState } from 'react';

import Landing from './pages/landing';
import Workspace from './pages/Workspace';
import InvarianceAnalysis from './pages/InvarianceAnalysis';
import type { Page } from './landing_components/Navbar';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('landing');

  return (
    <>
      {currentPage === 'landing' && <Landing onNavigate={setCurrentPage} />}
      {currentPage === 'workspace' && <Workspace onNavigate={setCurrentPage} />}
      {currentPage === 'invariance' && <InvarianceAnalysis onNavigate={setCurrentPage} />}
    </>
  );
}

export default App;
