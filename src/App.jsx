import { useState, useEffect } from "react";
import { ethers } from "ethers";
import factoryAbi from "./abi/CrowdFundFactory.json";
import campaignAbi from "./abi/CrowdFundLite.json";
import { FACTORY_ADDRESS } from "./config";
import "./App.css";

function App() {
  const [signer, setSigner] = useState(null);
  const [factory, setFactory] = useState(null);
  const [account, setAccount] = useState(null);

  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState("");

  const [campaigns, setCampaigns] = useState([]);
  const [loadingMap, setLoadingMap] = useState({});

  /* ---------------- HELPERS ---------------- */

  const setLoadingFor = (key, value) => {
    setLoadingMap((prev) => ({ ...prev, [key]: value }));
  };

  const timeLeft = (deadline) => {
    const diff = deadline * 1000 - Date.now();
    if (diff <= 0) return "Ended";
    return Math.floor(diff / 1000) + " sec";
  };

  const progressPercent = (raised, goal) => {
    const r = Number(raised);
    const g = Number(goal);
    if (g === 0) return 0;
    return Math.min((r / g) * 100, 100);
  };

  const isActive = (c) =>
    c.state === 0 && timeLeft(c.deadline) !== "Ended";

  /* ---------------- CONNECT WALLET ---------------- */

  async function connectWallet() {
    if (!window.ethereum) return alert("Install MetaMask");

    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    const network = await provider.getNetwork();

    // Sepolia chainId = 11155111
    if (Number(network.chainId) !== 11155111) {
      alert("Please switch to Sepolia Testnet");
      return;
    }

    const sign = await provider.getSigner();
    const addr = await sign.getAddress();

    const factoryContract = new ethers.Contract(
      FACTORY_ADDRESS,
      factoryAbi,
      sign
    );

    setSigner(sign);
    setFactory(factoryContract);
    setAccount(addr);

    await loadCampaigns(factoryContract, sign);
  }

  function disconnectWallet() {
    setSigner(null);
    setFactory(null);
    setAccount(null);
    setCampaigns([]);
  }

  /* ---------------- LOAD CAMPAIGNS ---------------- */

  async function loadCampaigns(factoryContract, signer) {
    try {
      const addresses = await factoryContract.getCampaigns();

      const data = await Promise.all(
        addresses.map(async (addr) => {
          const campaign = new ethers.Contract(
            addr,
            campaignAbi,
            signer
          );

          const goal = await campaign.goalAmount();
          const raised = await campaign.totalRaised();
          const deadline = await campaign.deadline();
          const state = await campaign.state();

          return {
            address: addr,
            goal: ethers.formatEther(goal),
            raised: ethers.formatEther(raised),
            deadline: Number(deadline),
            state: Number(state),
          };
        })
      );

      // ✅ ONLY ACTIVE CAMPAIGNS
      const activeCampaigns = data
        .reverse()
        .filter((c) => c.state === 0);

      setCampaigns(activeCampaigns);
    } catch (err) {
      console.error(err);
    }
  }

  /* ---------------- AUTO CONNECT ---------------- */

  useEffect(() => {
    async function autoConnect() {
      if (!window.ethereum) return;

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.listAccounts();

      if (accounts.length > 0) connectWallet();
    }

    autoConnect();
  }, []);

  /* ---------------- CREATE CAMPAIGN ---------------- */

  async function createCampaign() {
    if (!factory) return alert("Connect wallet first");

    try {
      setLoadingFor("create", true);

      const tx = await factory.createCampaign(goal, duration);
      await tx.wait();

      alert("Campaign Created!");

      await loadCampaigns(factory, signer);

      setGoal("");
      setDuration("");
    } catch (err) {
      console.error(err);
      alert(err.reason || err.message);
    } finally {
      setLoadingFor("create", false);
    }
  }

  /* ---------------- CONTRIBUTE ---------------- */

  async function contribute(addr) {
    try {
      setLoadingFor(addr, true);

      const campaign = new ethers.Contract(addr, campaignAbi, signer);

      const tx = await campaign.contribute({
        value: ethers.parseEther("0.01"),
      });

      await tx.wait();

      await loadCampaigns(factory, signer);
    } catch (err) {
      console.error(err);
      alert(err.reason || err.message);
    } finally {
      setLoadingFor(addr, false);
    }
  }

  /* ---------------- UI ---------------- */

  return (
    <div className="container">
      <h1 className="title">CrowdFund dApp</h1>

      {/* ✅ Sepolia Badge */}
      <div
        style={{
          marginBottom: 20,
          padding: "8px 14px",
          background: "#312e81",
          borderRadius: 8,
          display: "inline-block",
          fontSize: 14,
        }}
      >
        Running on <b>Sepolia Testnet</b>
      </div>

      {!account ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : (
        <>
          <p>
            Connected: {account.slice(0, 6)}...
            {account.slice(-4)}
          </p>
          <button onClick={disconnectWallet}>Disconnect</button>
        </>
      )}

      <hr />

      <h2>Create Campaign</h2>

      <input
        placeholder="Goal (ETH)"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />

      <input
        placeholder="Duration (seconds)"
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
      />

      <button
        disabled={loadingMap["create"]}
        onClick={createCampaign}
      >
        {loadingMap["create"] ? "Processing..." : "Create Campaign"}
      </button>

      <hr />

      <h2>Active Campaigns</h2>

      {campaigns.length === 0 && (
        <p>No active campaigns currently.</p>
      )}

      <div className="grid">
        {campaigns.map((c) => {
          const percent = progressPercent(c.raised, c.goal);
          const loading = loadingMap[c.address];

          return (
            <div key={c.address} className="card">
              <p>
                <b>
                  {c.address.slice(0, 8)}...
                  {c.address.slice(-4)}
                </b>
              </p>

              <p>Goal: {c.goal} ETH</p>
              <p>Raised: {c.raised} ETH</p>
              <p>Time Left: {timeLeft(c.deadline)}</p>

              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  disabled={loading || !isActive(c)}
                  onClick={() => contribute(c.address)}
                >
                  {loading ? "Processing..." : "Contribute (0.01 ETH)"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;