"use client";
import { useNetwork } from '../../hooks/useNetwork';
import { CHAINS } from '../config/chains';

export default function NetworkSelector() {
  const { chainId, switchNetwork } = useNetwork();
  return (
    <select
      className="border rounded-md px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
      value={chainId}
      onChange={(e) => switchNetwork(parseInt(e.target.value))}
    >
      {CHAINS.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
