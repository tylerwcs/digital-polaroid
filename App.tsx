import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import UploadView from './components/UploadView';
import DisplayView from './components/DisplayView';
import AdminView from './components/AdminView';
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
          {/* Admin route */}
          <Route path="/admin" element={<AdminView />} />
        </Routes>
      </HashRouter>
    </ToastProvider>
  );
};

export default App;