import React from 'react';
import { Link as RouterLink } from 'react-router-dom';

const Sidebar: React.FC = () => {
  return (
    <div className="w-60 bg-gray-100 p-4 h-full">
      <h2 className="text-xl font-bold mb-4">SuperSub</h2>
      <nav>
        <ul>
          <li className="mb-2">
            <RouterLink to="/" className="text-blue-600 hover:text-blue-800">
              Dashboard
            </RouterLink>
          </li>
          <li className="mb-2">
            <RouterLink to="/nodes" className="text-blue-600 hover:text-blue-800">
              Nodes
            </RouterLink>
          </li>
          <li className="mb-2">
            <RouterLink to="/subscriptions" className="text-blue-600 hover:text-blue-800">
              Subscriptions
            </RouterLink>
          </li>
          <li className="mb-2">
            <RouterLink to="/profiles" className="text-blue-600 hover:text-blue-800">
              Profiles
            </RouterLink>
          </li>
          <li className="mb-2">
            <RouterLink to="/subscription-rules" className="text-blue-600 hover:text-blue-800">
              Subscription Rules
            </RouterLink>
          </li>
          <li className="mb-2">
            <RouterLink to="/config-templates" className="text-blue-600 hover:text-blue-800">
              Config Templates
            </RouterLink>
          </li>
          <li className="mb-2">
            <RouterLink to="/settings" className="text-blue-600 hover:text-blue-800">
              Settings
            </RouterLink>
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;