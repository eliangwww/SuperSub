import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Subscription {
  id: string;
  name: string;
  url: string;
  node_count: number;
  last_updated: string;
}

const Subscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/subscriptions');
        if (response.data.success) {
          setSubscriptions(response.data.data);
        } else {
          setError(response.data.message || 'Failed to fetch subscriptions');
        }
      } catch (err) {
        setError('An error occurred while fetching subscriptions.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchSubscriptions();
  }, []);

  if (loading) {
    return <div className="p-4">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Subscriptions</h1>
      <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-4">
        Add Subscription
      </button>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                URL
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Node Count
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Updated
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {subscriptions && subscriptions.length > 0 ? (
              subscriptions.map(sub => (
                <tr key={sub.id}>
                  <td className="px-6 py-4 whitespace-nowrap">{sub.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{sub.url}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{sub.node_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{sub.last_updated}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-indigo-600 hover:text-indigo-900 mr-2">Edit</button>
                    <button className="text-green-600 hover:text-green-900 mr-2">Update</button>
                    <button className="text-purple-600 hover:text-purple-900 mr-2">Preview</button>
                    <button className="text-red-600 hover:text-red-900">Delete</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="text-center py-4">No subscriptions found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Subscriptions;