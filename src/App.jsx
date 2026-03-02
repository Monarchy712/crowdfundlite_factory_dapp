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
  const [showPrevious, setShowPrevious] = useState(false);

  const [loadingMap, setLoadingMap] = useState({});
  const [donationInputs, setDonationInputs] = useState({});

  /* ---------------- HELPERS ---------------- */

  const setLoadingFor = (key, value) => {
    setLoadingMap((prev) => ({ ...prev, [key]: value }));
  };

  const nowSeconds = () => Date.now() / 1000;

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

  /* ---------------- CONNECT WALLET ---------------- */

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

    await loadCampaigns(factoryContract, sign, addr);
  }

  /* ---------------- LOAD CAMPAIGNS ---------------- */

  async function loadCampaigns(factoryContract, signer, userAddr) {
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
        const owner = await campaign.owner();
        const contribution = await campaign.contributions(userAddr);

        return {
          address: addr,
          goal: ethers.formatEther(goal),
          raised: ethers.formatEther(raised),
          deadline: Number(deadline),
          state: Number(state),
          owner,
          userContribution: Number(contribution) > 0,
        };
      })
    );

    setCampaigns(data.reverse());
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

  /* ---------------- CREATE ---------------- */

  async function createCampaign() {
    setLoadingFor("create", true);

    const tx = await factory.createCampaign(goal, duration);
    await tx.wait();

    await loadCampaigns(factory, signer, account);

    setGoal("");
    setDuration("");
    setLoadingFor("create", false);
  }

  /* ---------------- CONTRIBUTE ---------------- */

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

  /* ---------------- WITHDRAW ---------------- */

  async function withdraw(addr) {
    setLoadingFor(addr, true);

    const campaign = new ethers.Contract(addr, campaignAbi, signer);
    const tx = await campaign.withdrawFunds();

    await tx.wait();
    await loadCampaigns(factory, signer, account);

    setLoadingFor(addr, false);
  }

  /* ---------------- REFUND ---------------- */

  async function refund(addr) {
    setLoadingFor(addr, true);

    const campaign = new ethers.Contract(addr, campaignAbi, signer);
    const tx = await campaign.refund();

    await tx.wait();
    await loadCampaigns(factory, signer, account);

    setLoadingFor(addr, false);
  }

  /* ---------------- VISIBILITY LOGIC ---------------- */

  const visibleCampaigns = campaigns.filter((c) => {
    const active = c.state === 0 && c.deadline > nowSeconds();
    const ownerCanWithdraw =
      c.state === 1 && c.owner.toLowerCase() === account?.toLowerCase();
    const userCanRefund = c.state === 2 && c.userContribution;

    if (showPrevious)
      return !active && (ownerCanWithdraw || userCanRefund);

    return active;
  });

  /* ---------------- UI ---------------- */

  return (
    <div className="container">
      <h1>CrowdFund dApp</h1>

      <p>Running on <b>Sepolia Testnet</b></p>

      <button onClick={() => setShowPrevious(!showPrevious)}>
        {showPrevious ? "View Active Campaigns" : "View Previous Campaigns"}
      </button>

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

              {/* contribute */}
              {c.state === 0 && (
                <>
                  <input
                    type="number"
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
                    Contribute
                  </button>
                </>
              )}

              {/* withdraw */}
              {c.state === 1 && isOwner && (
                <button onClick={() => withdraw(c.address)}>
                  Withdraw Funds
                </button>
              )}

              {/* refund */}
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
