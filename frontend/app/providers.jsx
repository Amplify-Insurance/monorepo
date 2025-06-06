// app/providers.jsx
"use client";

import React from 'react';
import { WagmiProvider } from 'wagmi';
import { config } from './config'; // Uses the updated config
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// 1. Import RainbowKitProvider and styles
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css'; // Import CSS

// Create queryClient instance
// If using React.useState for client:
// function Providers({ children }) {
//  const [queryClient] = React.useState(() => new QueryClient());
// ... rest is same

// This line already exports the function as a named export 'Providers'
export function Providers({ children }) {
   // If using useState for client:
   const [queryClient] = React.useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {/* 2. Wrap with RainbowKitProvider */}
        <RainbowKitProvider
          // Optional props for customization:
          // modalSize="compact"
          // theme={darkTheme()}
          // avatar={CustomAvatar}
          // locale="en-US"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// REMOVE THIS LINE - IT'S A DUPLICATE EXPORT
// export { Providers };