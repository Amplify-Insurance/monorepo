// app/api/pools/route.ts
import { NextResponse } from 'next/server';
import { getCapitalPool } from '../../../../lib/capitalPool';
import { getPoolRegistry } from '../../../../lib/poolRegistry';
import deployments from '../../../config/deployments';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const depName = url.searchParams.get('deployment');
    const dep = deployments.find((d) => d.name === depName) ?? deployments[0];

    const cp = getCapitalPool(dep.capitalPool, dep.name);
    const pr = getPoolRegistry(dep.poolRegistry, dep.name);

    // Fetch all necessary data, including unsettledPayouts
    const [totalNAV, unsettledPayouts, poolCount] = await Promise.all([
      cp.getTotalNAV(),
      cp.unsettledPayouts(),
      pr.getPoolCount(),
    ]);

    const count = Number(poolCount);
    let totalCoverSold = 0n;

    if (count > 0) {
      const poolData = await Promise.all(
        Array.from({ length: count }, (_, i) => pr.getPoolStaticData(i))
      );
      
      totalCoverSold = poolData.reduce(
        (acc, data) => acc + BigInt(data.totalCoverageSold.toString()), 
        0n
      );
    }
    
    const nav = BigInt(totalNAV.toString());
    const unsettled = BigInt(unsettledPayouts.toString());

    // Implement the requested calculation: NAV - Unsettled - Sold
    const netValueAfterUnsettled = nav > unsettled ? nav - unsettled : 0n;
    const available = netValueAfterUnsettled > totalCoverSold 
      ? netValueAfterUnsettled - totalCoverSold 
      : 0n;

    return NextResponse.json({ available: available.toString() });
  } catch (err: any) {
    console.error('Failed to fetch total available cover:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// // app/api/pools/route.ts
// import { NextResponse } from 'next/server';
// import { getCapitalPool } from '../../../../lib/capitalPool';
// import { getPoolRegistry } from '../../../../lib/poolRegistry';
// import deployments from '../../../config/deployments';
// import { ethers } from 'ethers';

// export async function GET(req: Request) {
//   try {
//     const url = new URL(req.url);
//     const depName = url.searchParams.get('deployment');
//     const dep = deployments.find((d) => d.name === depName) ?? deployments[0];

//     const cp = getCapitalPool(dep.capitalPool, dep.name);
//     const pr = getPoolRegistry(dep.poolRegistry, dep.name);

//     // Fetch all necessary data in parallel
//     const [totalNAV, poolCount] = await Promise.all([
//       cp.getTotalNAV(),
//       pr.getPoolCount(),
//     ]);

//     const count = Number(poolCount);
//     let totalCoverSold = 0n;

//     // If there are pools, fetch their data to calculate total sold cover
//     if (count > 0) {
//       const poolData = await Promise.all(
//         // Create an array from 0 to count-1 to fetch each pool's data
//         Array.from({ length: count }, (_, i) => pr.getPoolStaticData(i))
//       );
      
//       // Sum the `totalCoverageSold` from all pools
//       totalCoverSold = poolData.reduce(
//         (acc, data) => acc + BigInt(data.totalCoverageSold.toString()), 
//         0n
//       );
//     }
    
//     const nav = BigInt(totalNAV.toString());

//     // Calculate available cover: NAV - Total Sold
//     const available = nav > totalCoverSold ? nav - totalCoverSold : 0n;

//     return NextResponse.json({ available: available.toString() });
//   } catch (err: any) {
//     console.error('Failed to fetch total available cover:', err);
//     return NextResponse.json({ error: err.message }, { status: 500 });
//   }
// }