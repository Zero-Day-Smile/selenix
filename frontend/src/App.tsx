import React, { useState } from 'react';

import Landing from './pages/landing';
import Workspace from './pages/Workspace';

function App() {
  const [currentPage, setCurrentPage] = useState<'landing' | 'workspace'>('landing');

  return (
    <>
      {currentPage === 'landing' ? (
        <Landing onNavigate={setCurrentPage} />
      ) : (
        <Workspace onNavigate={setCurrentPage} />
      )}
    </>
  );
}

export default App;