// src/services/ipfs.ts

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

/**
 * Uploads data (text or JSON) to IPFS via Pinata.
 * If no API key is provided, it simulates an upload for testing purposes.
 */
export async function uploadToIPFS(content: string, type: 'url' | 'text' = 'url'): Promise<string> {
  // Mock upload if no API key is provided
  if (!PINATA_JWT) {
    console.warn("No Pinata JWT found. Simulating IPFS upload...");
    return new Promise((resolve) => {
      setTimeout(() => {
        // Generate a fake CID (IPFS Hash) starting with Qm
        const randomString = Math.random().toString(36).substring(2, 15);
        resolve(`QmMockHash${randomString}FakeCID1234567890`);
      }, 2000);
    });
  }

  // Real upload using Pinata API
  try {
    const data = JSON.stringify({
      pinataContent: {
        type: type,
        content: content,
        timestamp: new Date().toISOString(),
      },
      pinataMetadata: {
        name: `Archive-${new Date().getTime()}`,
      }
    });

    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PINATA_JWT}`
      },
      body: data
    });

    if (!response.ok) {
      throw new Error(`IPFS Upload failed: ${response.statusText}`);
    }

    const resData = await response.json();
    return resData.IpfsHash; // The Content Identifier (CID)
  } catch (error) {
    console.error("Error uploading to IPFS:", error);
    throw error;
  }
}
