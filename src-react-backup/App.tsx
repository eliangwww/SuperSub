import { Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import MainContent from './components/MainContent';
import Nodes from './components/Nodes';
import Profiles from './components/Profiles';
import Subscriptions from './components/Subscriptions';
import Sidebar from './components/Sidebar';
import Settings from './components/Settings';
import SubscriptionRules from './components/SubscriptionRules';
import ConfigTemplates from './components/ConfigTemplates';

function App() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 p-4">
        <Header />
        <Routes>
          <Route path="/" element={<MainContent />} />
          <Route path="/nodes" element={<Nodes />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/subscription-rules" element={<SubscriptionRules />} />
          <Route path="/config-templates" element={<ConfigTemplates />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
