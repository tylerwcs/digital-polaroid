import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import UploadView from './components/UploadView';
import DisplayView from './components/DisplayView';
import { ToastProvider } from './context/ToastContext';

const App: React.FC = () => {
  return (
    <ToastProvider>
      <HashRouter>
        <Routes>
          {/* Default route is the mobile uploader */}
          <Route path="/" element={<UploadView />} />
          {/* Display route for the big screen */}
          <Route path="/wall" element={<DisplayView />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
};

export default App;