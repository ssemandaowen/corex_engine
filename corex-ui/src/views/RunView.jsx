import React, { useState, useEffect } from 'react';
import client from "../api/client";

import RunCard from '../components/run/RunCard';

const RunView = () => {
  const [strategies, setStrategies] = useState([]);

  useEffect(() => {
    const fetchStatuses = async () => {
      const res = await client.get('/strategies');
      setStrategies(res.payload);
    };
    fetchStatuses();
  }, []);

  return (
    <div className="grid grid-cols-3 gap-6">
      {strategies.map(s => <RunCard key={s.id} strategy={s} />)}
    </div>
  );
};

export default RunView;