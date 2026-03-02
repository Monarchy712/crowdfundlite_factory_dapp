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
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  const [loadingMap, setLoadingMap] = useState({});
  const [donationInputs, setDonationInputs] = useState({});

  const [view, setView] = useState("active"); // active | previous

  /* ---------------- HELPERS ---------------- */

  const setLoadingFor = (k, v) =>
    setLoadingMap((p) => ({ ...p, [k]: v }));

  const now = () => Date.now() / 1000;

  const timeLeft = (deadline) => {
    const diff = deadline * 1000 - Date.now();
    if (diff <= 0) return "Ended";
    return Math.floor(diff / 1000) + " sec";
  };

  const progressPercent = (r, g) =>
    Math.min((Number(r) / Number(g)) * 100 || 0, 100);

  /* ---------------- CONNECT ---------------- */

  async function connectWallet() {
    if (!window.ethereum) return alert("Install MetaMask");

    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);

    const network = await provider.getNetwork();
    if (Number(network.chainId) !== 11155111)
      return alert("Switch to Sepolia");

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

    loadCampaigns(factoryContract, sign, addr);
  }

  /* ---------------- LOAD CAMPAIGNS ---------------- */

  async function loadCampaigns(factoryContract, signer, user) {
    try {
      setLoadingCampaigns(true);

      const addresses = await factoryContract.getCampaigns();

      const data = await Promise.all(
        addresses.map(async (addr) => {
          const campaign = new ethers.Contract(
            addr,
            campaignAbi,
            signer
          );

          const [goal, raised, deadline, state, owner, contrib] =
            await Promise.all([
              campaign.goalAmount(),
              campaign.totalRaised(),
              campaign.deadline(),
              campaign.state(),
              campaign.owner(),
              campaign.contributions(user),
            ]);

          return {
            address: addr,
            goal: ethers.formatEther(goal),
            raised: ethers.formatEther(raised),
            deadline: Number(deadline),
            state: Number(state),
            owner,
            userContribution: contrib > 0n,
          };
        })
      );

      setCampaigns(data.reverse());
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCampaigns(false);
    }
  }

  /* ---------------- CREATE ---------------- */

  async function createCampaign() {
    if (!factory) return alert("Connect wallet first");

    setLoadingFor("create", true);

    const tx = await factory.createCampaign(goal, duration);
    await tx.wait();

    await loadCampaigns(factory, signer, account);

    setGoal("");
    setDuration("");
    setLoadingFor("create", false);
  }

  /* ---------------- ACTIONS ---------------- */

  async function contribute(addr) {
    const amount = donationInputs[addr];
    if (!amount) return alert("Enter amount");

    setLoadingFor(addr, true);

    const campaign = new ethers.Contract(addr, campaignAbi, signer);
    const tx = await campaign.contribute({
      value: ethers.parseEther(amount),
    });

    await tx.wait();
    await loadCampaigns(factory, signer, account);

    setLoadingFor(addr, false);
  }

  async function withdraw(addr) {
    setLoadingFor(addr, true);
    const campaign = new ethers.Contract(addr, campaignAbi, signer);
    await (await campaign.withdrawFunds()).wait();
    await loadCampaigns(factory, signer, account);
    setLoadingFor(addr, false);
  }

  async function refund(addr) {
    setLoadingFor(addr, true);
    const campaign = new ethers.Contract(addr, campaignAbi, signer);
    await (await campaign.refund()).wait();
    await loadCampaigns(factory, signer, account);
    setLoadingFor(addr, false);
  }

  /* ---------------- VISIBILITY ---------------- */

  const visibleCampaigns = campaigns.filter((c) => {
    const active = c.state === 0 && c.deadline > now();
    const isOwner =
      c.owner.toLowerCase() === account?.toLowerCase();
    const refundable = c.state === 2 && c.userContribution;
    const withdrawable = c.state === 1 && isOwner;

    if (view === "active") return active;
    return !active && (withdrawable || refundable);
  });

  /* ---------------- UI ---------------- */

  return (
    <div className="container">
      <h1>CrowdFund dApp</h1>
      <p>Running on <b>Sepolia Testnet</b></p>

      {!account ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : (
        <p>
          Connected: {account.slice(0, 6)}...
          {account.slice(-4)}
        </p>
      )}

      <hr />

      {/* CREATE CAMPAIGN RESTORED */}
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
        {loadingMap["create"] ? "Creating..." : "Create Campaign"}
      </button>

      <hr />

      {/* TABS */}
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setView("active")}>
          Active Campaigns
        </button>
        <button onClick={() => setView("previous")}>
          Previous Campaigns
        </button>
      </div>

      {/* LOADING STATE */}
      {loadingCampaigns && <p>Loading campaigns...</p>}

      <div className="grid">
        {visibleCampaigns.map((c) => {
          const loading = loadingMap[c.address];
          const percent = progressPercent(c.raised, c.goal);
          const isOwner =
            c.owner.toLowerCase() === account?.toLowerCase();

          return (
            <div key={c.address} className="card">
              <p><b>{c.address.slice(0,8)}...{c.address.slice(-4)}</b></p>

              <p>Goal: {c.goal} ETH</p>
              <p>Raised: {c.raised} ETH</p>
              <p>Time Left: {timeLeft(c.deadline)}</p>

              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${percent}%` }}
                />
              </div>

              {c.state === 0 && (
                <>
                  <input
                    placeholder="ETH amount"
                    value={donationInputs[c.address] || ""}
                    onChange={(e) =>
                      setDonationInputs((p) => ({
                        ...p,
                        [c.address]: e.target.value,
                      }))
                    }
                  />
                  <button
                    disabled={loading}
                    onClick={() => contribute(c.address)}
                  >
                    {loading ? "Processing..." : "Contribute"}
                  </button>
                </>
              )}

              {c.state === 1 && isOwner && (
                <button onClick={() => withdraw(c.address)}>
                  Withdraw Funds
                </button>
              )}

              {c.state === 2 && c.userContribution && (
                <button onClick={() => refund(c.address)}>
                  Claim Refund
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
