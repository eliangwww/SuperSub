import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Node {
  id: string;
  group_id: string;
  name: string;
  server: string;
  port: number;
  type: string;
}

const Nodes: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/nodes');
        if (response.data.success) {
          setNodes(response.data.data);
        } else {
          setError(response.data.message || 'Failed to fetch nodes');
        }
      } catch (err) {
        setError('An error occurred while fetching nodes.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchNodes();
  }, []);

  if (loading) {
    return <div className="p-4">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Nodes</h1>
      <div className="mb-4">
        <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" onClick={() => alert('Add Node clicked')}>
          Add Node
        </button>
        <button className="ml-2 bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded" onClick={() => alert('Health Check All clicked')}>
          Health Check All
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Server
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Port
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Group
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Latency
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {nodes && nodes.length > 0 ? (
              nodes.map(node => (
                <tr key={node.id}>
                  <td className="px-6 py-4 whitespace-nowrap">{node.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{node.server}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{node.port}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{node.type}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{node.group_id}</td>
                  <td className="px-6 py-4 whitespace-nowrap">N/A</td>
                  <td className="px-6 py-4 whitespace-nowrap">N/A</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-indigo-600 hover:text-indigo-900 mr-2" onClick={() => alert(`Edit ${node.name}`)}>Edit</button>
                    <button className="text-green-600 hover:text-green-900 mr-2" onClick={() => alert(`Health Check ${node.name}`)}>Check</button>
                    <button className="text-red-600 hover:text-red-900" onClick={() => alert(`Delete ${node.name}`)}>Delete</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-4">No nodes found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Nodes;