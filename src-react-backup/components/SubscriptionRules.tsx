import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface SubscriptionRule {
  id: string;
  subscription_id: string;
  type: string;
  pattern: string;
  description?: string;
}

const SubscriptionRules: React.FC = () => {
  const [rules, setRules] = useState<SubscriptionRule[]>([]);

  useEffect(() => {
    const fetchRules = async () => {
      const response = await axios.get('/api/subscription-rules');
      setRules(response.data.data);
    };
    fetchRules();
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Subscription Rules</h1>
      <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-4">
        Add Rule
      </button>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Subscription ID
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Pattern
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Description
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rules.map(rule => (
              <tr key={rule.id}>
                <td className="px-6 py-4 whitespace-nowrap">{rule.subscription_id}</td>
                <td className="px-6 py-4 whitespace-nowrap">{rule.type}</td>
                <td className="px-6 py-4 whitespace-nowrap">{rule.pattern}</td>
                <td className="px-6 py-4 whitespace-nowrap">{rule.description}</td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button className="text-indigo-600 hover:text-indigo-900 mr-2">Edit</button>
                  <button className="text-red-600 hover:text-red-900">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SubscriptionRules;