import os

path = r'c:\Users\dipnr\Downloads\ORIN-1.6.2-Full-Developer-Package\source\app\settings-system.css'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

new_styles = """
/* =========================================================
   PRO REAL ASSET ICONS & UNIVERSAL VIP TRADE SIGNAL PORTAL
   ========================================================= */

/* Real Vector Asset Icons */
.asset-pro-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  transition: transform 0.15s ease;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.12));
}

.asset-pro-icon svg {
  display: block;
  width: 100%;
  height: 100%;
}

.coin-logo.asset-pro-logo {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}

.orin-market-row .coin-logo,
.quote-identity .coin-logo,
.home-quote-symbol .coin-logo,
.trade-pair-picker .coin-logo,
.market-card-open .coin-logo {
  background: transparent !important;
}

/* Home Screen VIP Trade Signal Portal Card */
.home-vip-code-card {
  position: relative;
  background: linear-gradient(135deg, #ffffff 0%, #f4f8ff 100%);
  border: 1.5px solid #c7dcff;
  border-radius: 18px;
  padding: 16px;
  margin: 16px 0 20px;
  box-shadow: 0 4px 20px rgba(11, 131, 250, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
  display: grid;
  gap: 12px;
  overflow: hidden;
}

.home-vip-code-card::before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: linear-gradient(90deg, #0284c7, #3b82f6, #10b981);
}

.home-vip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.home-vip-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.home-vip-icon-badge {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 3px 8px rgba(14, 165, 233, 0.3);
  flex-shrink: 0;
}

.home-vip-title h3 {
  font-size: 15px;
  font-weight: 750;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.3px;
}

.home-vip-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  color: #0369a1;
  background: #e0f2fe;
  padding: 2px 8px;
  border-radius: 6px;
  margin-top: 3px;
}

.home-vip-desc {
  font-size: 12px;
  color: #475569;
  line-height: 1.6;
  margin: 0;
}

.home-code-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.home-code-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  padding: 0 12px;
  height: 48px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.home-code-input-wrap:focus-within {
  border-color: #0284c7;
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
}

.code-input-ico {
  color: #0284c7;
  margin-inline-end: 8px;
  flex-shrink: 0;
}

.home-code-input-wrap input {
  flex: 1;
  width: 100%;
  border: none;
  background: transparent;
  outline: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.8px;
  direction: ltr;
  text-align: left;
}

.btn-paste-code {
  height: 48px;
  padding: 0 14px;
  background: #f1f5f9;
  border: 1.5px solid #cbd5e1;
  border-radius: 12px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-paste-code:active {
  background: #e2e8f0;
}

/* Amount selector in Home Portal */
.home-amount-quick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.home-amount-input-wrap {
  display: flex;
  align-items: center;
  background: #fff;
  border: 1.5px solid #cbd5e1;
  border-radius: 10px;
  height: 38px;
  padding: 0 10px;
  min-width: 130px;
  flex: 1;
}

.home-amount-currency {
  font-weight: 700;
  color: #64748b;
  margin-inline-end: 4px;
}

.home-amount-input-wrap input {
  width: 100%;
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  direction: ltr;
}

.home-amount-unit {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  margin-inline-start: 4px;
}

.home-amount-presets {
  display: flex;
  gap: 6px;
}

.home-amount-presets button {
  height: 38px;
  padding: 0 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
}

.home-amount-presets button.preset-active {
  background: #0284c7;
  color: #fff;
  border-color: #0284c7;
}

/* Home Action Buttons */
.home-vip-action-row {
  display: grid;
  grid-template-columns: 1.8fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.btn-execute-auto {
  height: 48px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, #059669 0%, #10b981 100%);
  color: #fff;
  font-size: 14px;
  font-weight: 750;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 3px 12px rgba(16, 185, 129, 0.25);
  transition: transform 0.15s ease, filter 0.15s ease;
}

.btn-execute-auto:active {
  transform: scale(0.98);
}

.btn-execute-auto:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.btn-review-terms {
  height: 48px;
  border-radius: 12px;
  border: 1.5px solid #cbd5e1;
  background: #fff;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn-review-terms:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Home Active Trade Tracker */
.home-active-trade-card {
  background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
  color: #fff;
  border-radius: 16px;
  padding: 14px 16px;
  margin: 14px 0 6px;
  display: grid;
  gap: 10px;
  box-shadow: 0 4px 16px rgba(6, 78, 59, 0.25);
}

.home-active-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.home-active-top .live-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: #a7f3d0;
}

.home-active-top .live-timer-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 10px;
  border-radius: 20px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  font-weight: 700;
  color: #6ee7b7;
}

.home-active-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.2);
  padding: 8px 12px;
  border-radius: 10px;
}

.active-asset-tag {
  display: flex;
  align-items: center;
  gap: 8px;
}

.active-asset-tag b {
  font-size: 14px;
}

.active-asset-tag small {
  font-size: 12px;
  font-weight: 700;
}

.active-return-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.active-return-tag strong {
  font-size: 15px;
  color: #6ee7b7;
}

.btn-view-active-trade {
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}

/* ReferenceTrade Top Portal */
.vip-portal-top {
  margin-top: 6px !important;
  margin-bottom: 12px !important;
}

.code-action-dual-buttons {
  display: grid;
  grid-template-columns: 1.7fr 1fr;
  gap: 8px;
}

.enter-auto-btn {
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
  color: #fff !important;
  font-size: 14px !important;
  font-weight: 750 !important;
  display: flex !important;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 3px 12px rgba(16, 185, 129, 0.25);
  cursor: pointer;
}

@media (max-width: 480px) {
  .home-vip-action-row,
  .code-action-dual-buttons {
    grid-template-columns: 1fr;
  }
}
"""

with open(path, 'w', encoding='utf-8') as f:
    f.write(text + '\n' + new_styles)

print("Appended new styles to settings-system.css!")
