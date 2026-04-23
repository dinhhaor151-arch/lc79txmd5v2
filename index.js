'use strict';
const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIG ====================
const GAMES = {
    lc79_hu:  { api: 'https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5', name: 'TAI XIU HU' },
    lc79_md5: { api: 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8', name: 'TAI XIU MD5' }
};
const state = {
    lc79_hu:  { history: [], rawHistory: [], lastPhien: 0, lastTotal: 0, lastResult: null, updatedAt: null },
    lc79_md5: { history: [], rawHistory: [], lastPhien: 0, lastTotal: 0, lastResult: null, updatedAt: null }
};

// ==================== UTILS ====================
function calculateStdDev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length);
}
function getDiceFrequencies(history, limit) {
    const allDice = [];
    history.slice(0, limit).forEach(s => allDice.push(s.d1, s.d2, s.d3));
    const freq = new Array(7).fill(0);
    allDice.forEach(d => { if (d >= 1 && d <= 6) freq[d]++; });
    return freq;
}

// ==================== LOGIC 1-12 ====================
function predictLogic1(lastSession, history) {
    if (!lastSession || history.length < 10) return null;
    const indicatorSum = (lastSession.sid % 10) + lastSession.total;
    const currentPrediction = indicatorSum % 2 === 0 ? "Xiu" : "Tai";
    let correctCount = 0, totalCount = 0;
    const w = Math.min(history.length - 1, 25);
    for (let i = 0; i < w; i++) {
        const session = history[i], prevSession = history[i + 1];
        if (prevSession) {
            const prevPredicted = ((prevSession.sid % 10) + prevSession.total) % 2 === 0 ? "Xiu" : "Tai";
            if (prevPredicted === session.result) correctCount++;
            totalCount++;
        }
    }
    if (totalCount > 5 && (correctCount / totalCount) >= 0.65) return currentPrediction;
    return null;
}
function predictLogic2(nextSessionId, history) {
    if (history.length < 15) return null;
    let thuanScore = 0, nghichScore = 0;
    const w = Math.min(history.length, 60);
    for (let i = 0; i < w; i++) {
        const session = history[i];
        const isEvenSID = session.sid % 2 === 0;
        const weight = 1.0 - (i / w) * 0.6;
        if ((isEvenSID && session.result === "Xiu") || (!isEvenSID && session.result === "Tai")) thuanScore += weight;
        if ((isEvenSID && session.result === "Tai") || (!isEvenSID && session.result === "Xiu")) nghichScore += weight;
    }
    const currentSessionIsEven = nextSessionId % 2 === 0;
    const totalScore = thuanScore + nghichScore;
    if (totalScore < 10) return null;
    const thuanRatio = thuanScore / totalScore, nghichRatio = nghichScore / totalScore;
    if (thuanRatio > nghichRatio + 0.15) return currentSessionIsEven ? "Xiu" : "Tai";
    else if (nghichRatio > thuanRatio + 0.15) return currentSessionIsEven ? "Tai" : "Xiu";
    return null;
}
function predictLogic3(history) {
    if (history.length < 15) return null;
    const w = Math.min(history.length, 50);
    const totals = history.slice(0, w).map(s => s.total);
    const avg = totals.reduce((a, b) => a + b, 0) / w;
    const std = calculateStdDev(totals);
    const recentLen = Math.min(5, history.length);
    const recent = history.slice(0, recentLen).map(s => s.total);
    let isRising = recentLen >= 3, isFalling = recentLen >= 3;
    for (let i = 0; i < recentLen - 1; i++) {
        if (recent[i] <= recent[i+1]) isRising = false;
        if (recent[i] >= recent[i+1]) isFalling = false;
    }
    if (avg < 10.5 - (0.8 * std) && isFalling) return "Xiu";
    if (avg > 10.5 + (0.8 * std) && isRising) return "Tai";
    return null;
}
function predictLogic4(history) {
    if (history.length < 30) return null;
    const vol = calculateStdDev(history.slice(0, 30).map(s => s.total));
    const lens = vol < 1.7 ? [6,5,4] : [5,4,3];
    let best = null, maxConf = 0;
    for (const len of lens) {
        if (history.length < len + 2) continue;
        const pat = history.slice(0, len).map(s => s.result).reverse().join('');
        let tai = 0, xiu = 0, total = 0;
        for (let i = len; i < Math.min(history.length - 1, 200); i++) {
            if (history.slice(i, i+len).map(s => s.result).reverse().join('') === pat) {
                total++;
                if (history[i-1].result === 'Tai') tai++; else xiu++;
            }
        }
        if (total < 3) continue;
        if (tai/total >= 0.70 && tai/total > maxConf) { maxConf = tai/total; best = "Tai"; }
        else if (xiu/total >= 0.70 && xiu/total > maxConf) { maxConf = xiu/total; best = "Xiu"; }
    }
    return best;
}
function predictLogic5(history) {
    if (history.length < 40) return null;
    const sumCounts = {};
    const w = Math.min(history.length, 400);
    for (let i = 0; i < w; i++) {
        const weight = 1.0 - (i / w) * 0.8;
        sumCounts[history[i].total] = (sumCounts[history[i].total] || 0) + weight;
    }
    let mostFreq = -1, maxW = 0;
    for (const s in sumCounts) if (sumCounts[s] > maxW) { maxW = sumCounts[s]; mostFreq = parseInt(s); }
    if (mostFreq !== -1) {
        const totalW = Object.values(sumCounts).reduce((a,b) => a+b, 0);
        if (totalW > 0 && (maxW / totalW) > 0.08) {
            const neighbors = [];
            if (sumCounts[mostFreq-1]) neighbors.push(sumCounts[mostFreq-1]);
            if (sumCounts[mostFreq+1]) neighbors.push(sumCounts[mostFreq+1]);
            if (neighbors.every(n => maxW > n * 1.05)) {
                if (mostFreq <= 10) return "Xiu";
                if (mostFreq >= 11) return "Tai";
            }
        }
    }
    return null;
}
function predictLogic6(lastSession, history) {
    if (!lastSession || history.length < 40) return null;
    const nextDig = (lastSession.sid + 1) % 10;
    const lastParity = lastSession.total % 2;
    let tai = 0, xiu = 0;
    const w = Math.min(history.length, 250);
    for (let i = 0; i < w - 1; i++) {
        if (`${history[i+1].sid%10%2}-${history[i+1].total%2}-${history[i+1].total>10.5?'T':'X'}` === `${nextDig%2}-${lastParity}-${lastSession.total>10.5?'T':'X'}`) {
            if (history[i].result === "Tai") tai++; else xiu++;
        }
    }
    const total = tai + xiu;
    if (total >= 5 && Math.abs(tai - xiu) / total > 0.25) return tai > xiu ? "Tai" : "Xiu";
    return null;
}
function predictLogic7(history) {
    if (history.length < 4) return null;
    const streakLen = calculateStdDev(history.slice(0, Math.min(25, history.length)).map(s => s.total)) < 1.6 ? 7 : 5;
    const recent = history.slice(0, streakLen).map(s => s.result);
    if (recent.length < streakLen) return null;
    if (recent.every(r => r === "Tai") && history.slice(streakLen, streakLen+2).filter(s => s.result === "Tai").length >= 1) return "Tai";
    if (recent.every(r => r === "Xiu") && history.slice(streakLen, streakLen+2).filter(s => s.result === "Xiu").length >= 1) return "Xiu";
    return null;
}
function predictLogic8(history) {
    if (history.length < 31) return null;
    const longTotals = history.slice(1, 31).map(s => s.total);
    const threshold = Math.max(1.5, 0.8 * calculateStdDev(longTotals));
    const last5 = history.slice(0, Math.min(5, history.length)).map(s => s.total);
    let rising = last5.length >= 2, falling = last5.length >= 2;
    for (let i = 0; i < last5.length - 1; i++) {
        if (last5[i] <= last5[i+1]) rising = false;
        if (last5[i] >= last5[i+1]) falling = false;
    }
    const avg = longTotals.reduce((a,b) => a+b, 0) / 30;
    if (history[0].total > avg + threshold && rising) return "Xiu";
    if (history[0].total < avg - threshold && falling) return "Tai";
    return null;
}
function predictLogic9(history) {
    if (history.length < 20) return null;
    let maxTai = 0, maxXiu = 0, cTai = 0, cXiu = 0;
    for (const s of history.slice(0, Math.min(history.length, 120))) {
        if (s.result === "Tai") { cTai++; cXiu = 0; } else { cXiu++; cTai = 0; }
        maxTai = Math.max(maxTai, cTai); maxXiu = Math.max(maxXiu, cXiu);
    }
    let cur = 0;
    for (let i = 0; i < history.length; i++) { if (history[i].result === history[0].result) cur++; else break; }
    if (cur >= Math.max(4, Math.floor(Math.max(maxTai, maxXiu) * 0.5)) && cur >= 3) {
        let rev = 0, cont = 0;
        for (let i = cur; i < history.length - cur; i++) {
            if (history.slice(i, i+cur).every(s => s.result === history[0].result)) {
                if (history[i-1] && history[i-1].result !== history[0].result) rev++;
                else if (history[i-1] && history[i-1].result === history[0].result) cont++;
            }
        }
        if (rev + cont > 3 && rev > cont * 1.3) return history[0].result === "Tai" ? "Xiu" : "Tai";
    }
    return null;
}
function predictLogic10(history) {
    if (history.length < 8) return null;
    if (history.slice(0,3).every(r => r.result === "Tai") && history.slice(0,7).filter(r => r.result === "Tai").length/7 >= 0.75 && predictLogic9(history) !== "Xiu") return "Tai";
    if (history.slice(0,3).every(r => r.result === "Xiu") && history.slice(0,7).filter(r => r.result === "Xiu").length/7 >= 0.75 && predictLogic9(history) !== "Tai") return "Xiu";
    return null;
}
function predictLogic11(history) {
    if (history.length < 15) return null;
    const patterns = [
        {p:"TXT",pred:"Xiu",min:3,w:1.5},{p:"XTX",pred:"Tai",min:3,w:1.5},
        {p:"TTX",pred:"Tai",min:4,w:1.3},{p:"XXT",pred:"Xiu",min:4,w:1.3},
        {p:"TXX",pred:"Tai",min:3,w:1.4},{p:"XTT",pred:"Xiu",min:3,w:1.4},
        {p:"XTTX",pred:"Xiu",min:2,w:1.6},{p:"TXXT",pred:"Tai",min:2,w:1.6},
        {p:"TXTX",pred:"Tai",min:2,w:1.4},{p:"XTXT",pred:"Xiu",min:2,w:1.4},
        {p:"TXXX",pred:"Tai",min:1,w:1.7},{p:"XTTT",pred:"Xiu",min:1,w:1.7},
    ];
    let best = null, maxW = 0;
    for (const pd of patterns) {
        if (history.length < pd.p.length + 1) continue;
        if (history.slice(0, pd.p.length).map(s => s.result === 'Tai' ? 'T' : 'X').reverse().join('') !== pd.p) continue;
        let match = 0, total = 0;
        for (let i = pd.p.length; i < Math.min(history.length - 1, 350); i++) {
            if (history.slice(i, i+pd.p.length).map(s => s.result === 'Tai' ? 'T' : 'X').reverse().join('') === pd.p) {
                total++;
                if (history[i-1].result === pd.pred) match++;
            }
        }
        if (total >= pd.min && match/total >= 0.68 && (match/total)*pd.w > maxW) {
            maxW = (match/total)*pd.w; best = pd.pred;
        }
    }
    return best;
}
function predictLogic12(lastSession, history) {
    if (!lastSession || history.length < 20) return null;
    let cur = 0;
    for (let i = 0; i < history.length; i++) { if (history[i].result === history[0].result) cur++; else break; }
    let tai = 0, xiu = 0;
    for (let i = 0; i < Math.min(history.length, 250) - 1; i++) {
        let hCur = 0;
        for (let j = i+1; j < Math.min(history.length, 250); j++) { if (history[j].result === history[i+1].result) hCur++; else break; }
        if (history[i+1].sid % 2 === (lastSession.sid+1) % 2 && hCur === cur) {
            if (history[i].result === "Tai") tai++; else xiu++;
        }
    }
    if (tai + xiu >= 6) {
        if (tai/(tai+xiu) >= 0.68) return "Tai";
        if (xiu/(tai+xiu) >= 0.68) return "Xiu";
    }
    return null;
}

// ==================== LOGIC 13-24 ====================
function predictLogic13(history) {
    if (history.length < 80) return null;
    let cur = 0;
    for (let i = 0; i < history.length; i++) { if (history[i].result === history[0].result) cur++; else break; }
    if (cur < 1) return null;
    const stats = {};
    for (let i = 0; i < Math.min(history.length, 500) - 1; i++) {
        let len = 1;
        for (let j = i+2; j < Math.min(history.length, 500); j++) { if (history[j].result === history[i+1].result) len++; else break; }
        const key = `${history[i+1].result}_${len}`;
        if (!stats[key]) stats[key] = {Tai:0,Xiu:0};
        stats[key][history[i].result]++;
    }
    const s = stats[`${history[0].result}_${cur}`];
    if (s && s.Tai + s.Xiu >= 5) {
        if (s.Tai/(s.Tai+s.Xiu) >= 0.65) return "Tai";
        if (s.Xiu/(s.Tai+s.Xiu) >= 0.65) return "Xiu";
    }
    return null;
}
function predictLogic14(history) {
    if (history.length < 50) return null;
    const shortAvg = history.slice(0,8).map(s=>s.total).reduce((a,b)=>a+b,0)/8;
    const longTotals = history.slice(0,30).map(s=>s.total);
    const longAvg = longTotals.reduce((a,b)=>a+b,0)/30;
    const std = calculateStdDev(longTotals);
    if (shortAvg > longAvg + std*0.8 && history.slice(0,2).every(s=>s.result==="Tai")) return "Xiu";
    if (shortAvg < longAvg - std*0.8 && history.slice(0,2).every(s=>s.result==="Xiu")) return "Tai";
    return null;
}
function predictLogic15(history) {
    if (history.length < 80) return null;
    const even = {Tai:0,Xiu:0}, odd = {Tai:0,Xiu:0};
    let tE = 0, tO = 0;
    for (let i = 0; i < Math.min(history.length, 400); i++) {
        if (history[i].total % 2 === 0) { even[history[i].result]++; tE++; }
        else { odd[history[i].result]++; tO++; }
    }
    if (tE < 20 || tO < 20) return null;
    if (history[0].total % 2 === 0) {
        if (even.Tai/tE >= 0.65) return "Tai";
        if (even.Xiu/tE >= 0.65) return "Xiu";
    } else {
        if (odd.Tai/tO >= 0.65) return "Tai";
        if (odd.Xiu/tO >= 0.65) return "Xiu";
    }
    return null;
}
function predictLogic16(history) {
    if (history.length < 60) return null;
    const mod = {};
    for (let i = 0; i < Math.min(history.length, 500) - 1; i++) {
        const k = history[i+1].total % 5;
        if (!mod[k]) mod[k] = {Tai:0,Xiu:0};
        mod[k][history[i].result]++;
    }
    const s = mod[history[0].total % 5];
    if (s && s.Tai + s.Xiu >= 7) {
        if (s.Tai/(s.Tai+s.Xiu) >= 0.65) return "Tai";
        if (s.Xiu/(s.Tai+s.Xiu) >= 0.65) return "Xiu";
    }
    return null;
}
function predictLogic17(history) {
    if (history.length < 100) return null;
    const totals = history.slice(0, Math.min(history.length, 600)).map(s => s.total);
    const mean = totals.reduce((a,b)=>a+b,0)/totals.length;
    const std = calculateStdDev(totals);
    if (std > 0 && Math.abs(history[0].total - mean)/std >= 1.5)
        return history[0].total > mean ? "Xiu" : "Tai";
    return null;
}
function predictLogic18(history) {
    if (history.length < 50) return null;
    const ps = {};
    for (let i = 0; i < Math.min(history.length, 300) - 1; i++) {
        const k = `${history[i+1].d1%2}-${history[i+1].d2%2}-${history[i+1].d3%2}`;
        if (!ps[k]) ps[k] = {Tai:0,Xiu:0};
        ps[k][history[i].result]++;
    }
    const ck = `${history[0].d1%2}-${history[0].d2%2}-${history[0].d3%2}`;
    if (ps[ck] && ps[ck].Tai + ps[ck].Xiu >= 8) {
        if (ps[ck].Tai/(ps[ck].Tai+ps[ck].Xiu) >= 0.65) return "Tai";
        if (ps[ck].Xiu/(ps[ck].Tai+ps[ck].Xiu) >= 0.65) return "Xiu";
    }
    return null;
}
function predictLogic19(history) {
    if (history.length < 50) return null;
    let tai = 0, xiu = 0;
    const now = Date.now();
    for (const s of history) {
        if (now - s.timestamp > 7200000) break;
        const age = 1 - ((now - s.timestamp) / 7200000);
        const w = Math.pow(age, 3);
        if (s.result === "Tai") tai += w; else xiu += w;
    }
    if (tai + xiu >= 10) {
        if (tai/(tai+xiu) > xiu/(tai+xiu) + 0.10) return "Tai";
        if (xiu/(tai+xiu) > tai/(tai+xiu) + 0.10) return "Xiu";
    }
    return null;
}
function markovWeightedV3(arr) {
    if (arr.length < 3) return null;
    const t = {};
    for (let i = 0; i < arr.length - 1; i++) {
        const k = arr[i] + arr[i+1];
        if (!t[k]) t[k] = {T:0,X:0};
        if (i+2 < arr.length) t[k][arr[i+2]]++;
    }
    const last = t[arr[arr.length-2]+arr[arr.length-1]];
    if (last && last.T+last.X > 3) {
        if (last.T/(last.T+last.X) > 0.60) return "Tai";
        if (last.X/(last.T+last.X) > 0.60) return "Xiu";
    }
    return null;
}
function repeatingPatternV3(arr) {
    if (arr.length < 4) return null;
    let tai = 0, xiu = 0, total = 0;
    for (let i = 0; i < arr.length - 4; i++) {
        if (arr.slice(-3).join('') === arr.slice(i,i+3).join('') || arr.slice(-4).join('') === arr.slice(i,i+4).join('')) {
            total++;
            if (arr[i+4] === 'T') tai++; else xiu++;
        }
    }
    if (total >= 3) {
        if (tai/total > 0.65) return "Tai";
        if (xiu/total > 0.65) return "Xiu";
    }
    return null;
}
function detectBiasV3(arr) {
    if (arr.length < 5) return null;
    const tc = arr.filter(r => r === 'T').length;
    if (tc/arr.length > 0.60) return "Tai";
    if ((arr.length-tc)/arr.length > 0.60) return "Xiu";
    return null;
}
function predictLogic21(history) {
    if (history.length < 20) return null;
    const arr = history.map(s => s.result === 'Tai' ? 'T' : 'X');
    const votes = {Tai:0,Xiu:0};
    let total = 0;
    [3,5,8,12,20,30,40,60,80].forEach(w => {
        if (arr.length >= w) {
            const sub = arr.slice(0, w);
            const m = markovWeightedV3(sub.slice().reverse());
            if (m) { votes[m] += (w/10)*0.7; total += (w/10)*0.7; }
            const r = repeatingPatternV3(sub.slice().reverse());
            if (r) { votes[r] += (w/10)*0.15; total += (w/10)*0.15; }
            const b = detectBiasV3(sub);
            if (b) { votes[b] += (w/10)*0.15; total += (w/10)*0.15; }
        }
    });
    if (total === 0) return null;
    if (votes.Tai > votes.Xiu * 1.08) return "Tai";
    if (votes.Xiu > votes.Tai * 1.08) return "Xiu";
    return null;
}
function predictLogic22(history) {
    if (history.length < 15) return null;
    const res = history.map(s => s.result === 'Tai' ? 'T' : 'X');
    let tai = 0, xiu = 0, tw = 0;
    let cur = 0;
    for (let i = 0; i < res.length; i++) { if (res[i] === res[0]) cur++; else break; }
    if (cur >= 3) {
        let brk = 0, cont = 0;
        for (let i = cur; i < Math.min(res.length, 200); i++) {
            if (res.slice(i, i+cur).every(r => r === res[0]) && res[i-1]) {
                if (res[i-1] === res[0]) cont++; else brk++;
            }
        }
        if (brk + cont > 5) {
            if (brk/(brk+cont) > 0.65) { if (res[0]==='T') xiu+=1.5; else tai+=1.5; tw+=1.5; }
            else if (cont/(brk+cont) > 0.65) { if (res[0]==='T') tai+=1.5; else xiu+=1.5; tw+=1.5; }
        }
    }
    if (history.length >= 4) {
        const pat = res.slice(0,4).join('').substring(0,3);
        let pm = 0, tf = 0, xf = 0;
        for (let i = 0; i < Math.min(res.length, 150) - 3; i++) {
            if (res.slice(i,i+3).join('') === pat) {
                if (res[i+3]==='T') tf++; else xf++;
                pm++;
            }
        }
        if (pm > 4) {
            if (tf/pm > 0.70) { tai+=1.2; tw+=1.2; }
            else if (xf/pm > 0.70) { xiu+=1.2; tw+=1.2; }
        }
    }
    if (tw === 0) return null;
    if (tai > xiu * 1.1) return "Tai";
    if (xiu > tai * 1.1) return "Xiu";
    return null;
}
function predictLogic23(history) {
    if (history.length < 5) return null;
    const totals = history.map(s => s.total);
    const allDice = history.slice(0, Math.min(history.length, 10)).flatMap(s => [s.d1, s.d2, s.d3]);
    const freq = getDiceFrequencies(history, 10);
    const preds = [];
    if (history.length >= 2) preds.push((totals[0]+totals[1])%2===0?"Tai":"Xiu");
    preds.push(totals.slice(0,Math.min(history.length,10)).reduce((a,b)=>a+b,0)/Math.min(history.length,10)>10.5?"Tai":"Xiu");
    preds.push(freq[4]+freq[5]>freq[1]+freq[2]?"Tai":"Xiu");
    preds.push(history.filter(s=>s.total>10).length>history.length/2?"Tai":"Xiu");
    if (history.length>=3) preds.push(totals.slice(0,3).reduce((a,b)=>a+b,0)>33?"Tai":"Xiu");
    if (history.length>=5) preds.push(Math.max(...totals.slice(0,5))>15?"Tai":"Xiu");
    if (history.length>=5) preds.push(totals.slice(0,5).filter(t=>t>10).length>=3?"Tai":"Xiu");
    if (history.length>=3) preds.push(totals.slice(0,3).reduce((a,b)=>a+b,0)>34?"Tai":"Xiu");
    if (history.length>=2) {
        preds.push(totals[0]>10&&totals[1]>10?"Tai":"Xiu");
        preds.push(totals[0]<10&&totals[1]<10?"Xiu":"Tai");
    }
    preds.push((totals[0]+freq[3])%2===0?"Tai":"Xiu");
    preds.push(freq[2]>3?"Tai":"Xiu");
    preds.push([11,12,13].includes(totals[0])?"Tai":"Xiu");
    if (history.length>=2) preds.push(totals[0]+totals[1]>30?"Tai":"Xiu");
    preds.push(allDice.filter(d=>d>3).length>7?"Tai":"Xiu");
    preds.push(totals[0]%2===0?"Tai":"Xiu");
    preds.push(allDice.filter(d=>d>3).length>8?"Tai":"Xiu");
    if (history.length>=3) {
        preds.push(totals.slice(0,3).reduce((a,b)=>a+b,0)%4===0?"Tai":"Xiu");
        preds.push(totals.slice(0,3).reduce((a,b)=>a+b,0)%3===0?"Tai":"Xiu");
    }
    preds.push(totals[0]%3===0?"Tai":"Xiu");
    preds.push(totals[0]%5===0?"Tai":"Xiu");
    preds.push(totals[0]%4===0?"Tai":"Xiu");
    preds.push(freq[4]>2?"Tai":"Xiu");
    const tc = preds.filter(p=>p==="Tai").length;
    const xc = preds.filter(p=>p==="Xiu").length;
    if (tc > xc * 1.5) return "Tai";
    if (xc > tc * 1.5) return "Xiu";
    return null;
}
const PATTERN_DATA = {
    "ttxttx":{tai:80,xiu:20},"xxttxx":{tai:25,xiu:75},"ttxxtt":{tai:75,xiu:25},
    "txtxt":{tai:60,xiu:40},"xtxtx":{tai:40,xiu:60},"ttx":{tai:70,xiu:30},
    "xxt":{tai:30,xiu:70},"txt":{tai:65,xiu:35},"xtx":{tai:35,xiu:65},
    "tttt":{tai:85,xiu:15},"xxxx":{tai:15,xiu:85},"ttttt":{tai:88,xiu:12},
    "xxxxx":{tai:12,xiu:88},"tttttt":{tai:92,xiu:8},"xxxxxx":{tai:8,xiu:92}
};
function predictLogic24(history) {
    if (!history || history.length < 5) return null;
    const votes = [];
    const seq = history.slice(0,3).reverse().map(s=>s.result==='Tai'?'t':'x').join('');
    if (PATTERN_DATA[seq]) {
        const p = PATTERN_DATA[seq];
        if (p.tai > p.xiu + 15) votes.push("Tai");
        else if (p.xiu > p.tai + 15) votes.push("Xiu");
    }
    const tc = votes.filter(v=>v==="Tai").length;
    const xc = votes.filter(v=>v==="Xiu").length;
    if (tc + xc < 4) return null;
    if (tc >= xc + 3) return "Tai";
    if (xc >= tc + 3) return "Xiu";
    return null;
}
function logic25(history) {
    const last5 = history.slice(-5);
    let count = 1;
    for (let i = last5.length-1; i > 0; i--) { if (last5[i]===last5[i-1]) count++; else break; }
    if (count >= 3) return last5[last5.length-1].result === 'Tai' ? 'T' : 'X';
    return null;
}
function logic26(history) {
    const last5 = history.slice(-5);
    if (last5.filter(r=>r.result==='Tai').length >= 4) return 'X';
    if (last5.filter(r=>r.result==='Xiu').length >= 4) return 'T';
    return null;
}

// ==================== DEEP ANALYSIS (GIỐNG HỆT deepAnalysis GỐC) ====================
function deepAnalysis(h, gameId, lastTotal, lastPhien) {
    if (!h || h.length < 6) return { prediction: null, confidence: 0, logic: 'CAU CHUA ON DINH', isReversal: false };

    // Build historyObjs giống gốc
    const histObjs = h.map((r, i) => ({
        result: r === 1 ? "Tai" : "Xiu",
        total: r === 1 ? 14 : 7,
        sid: i,
        d1: 3, d2: 3, d3: r === 1 ? 2 : 1,
        timestamp: Date.now() - i * 60000
    }));

    let pStr = h.slice(0, Math.min(30, h.length)).join('');
    let curStreak = 0;
    for (let i = 0; i < h.length; i++) { if (h[i] === h[0]) curStreak++; else break; }

    let finalPred = -1, logicMsg = "", confBase = 0;
    let isReversal = false, reversalFrom = "";

    // ENSEMBLE VOTES
    const ev = {tai:0, xiu:0};
    try {
        const p1 = predictLogic1({sid:lastPhien,total:lastTotal}, histObjs); if(p1==="Tai") ev.tai++; else if(p1==="Xiu") ev.xiu++;
        const p3 = predictLogic3(histObjs); if(p3==="Tai") ev.tai++; else if(p3==="Xiu") ev.xiu++;
        const p4 = predictLogic4(histObjs); if(p4==="Tai") ev.tai++; else if(p4==="Xiu") ev.xiu++;
        const p7 = predictLogic7(histObjs); if(p7==="Tai") ev.tai++; else if(p7==="Xiu") ev.xiu++;
        const p9 = predictLogic9(histObjs); if(p9==="Tai") ev.tai++; else if(p9==="Xiu") ev.xiu++;
        const p11 = predictLogic11(histObjs); if(p11==="Tai") ev.tai++; else if(p11==="Xiu") ev.xiu++;
        const p21 = predictLogic21(histObjs); if(p21==="Tai") ev.tai++; else if(p21==="Xiu") ev.xiu++;
        const p25 = logic25(histObjs); if(p25==='T') ev.tai++; else if(p25==='X') ev.xiu++;
        const p26 = logic26(histObjs); if(p26==='T') ev.tai++; else if(p26==='X') ev.xiu++;
    } catch(e) {}

    // ĐẢO NHỊP 4 PHIÊN
    let daoNhip4 = -1;
    if (h.length >= 5) {
        const last4 = h.slice(1,5).join('');
        if (last4==='1111'||last4==='0000') {
            daoNhip4 = h[0]===1?0:1; isReversal=true;
            reversalFrom = h[0]===1?'TAI':'XIU';
            logicMsg = "VIP PRO: DAO NHIP BE BET TU 4 PHIEN"; confBase = 98;
        } else if (last4==='1010'||last4==='0101') {
            daoNhip4 = h[0]; isReversal=true;
            reversalFrom = h[0]===1?'XIU':'TAI';
            logicMsg = "VIP PRO: DAO NHIP CAT PING PONG LUA"; confBase = 98;
        }
    }

    // MD5 SPECIAL
    if (gameId === 'lc79_md5') {
        const str = h.slice(0,5).join('');
        if (str==='11111'||str==='00000') { finalPred=h[0]===1?0:1; logicMsg="MD5: DINH BET->BE"; confBase=98; }
        else if (str.startsWith('101')||str.startsWith('010')) { finalPred=h[0]===1?0:1; logicMsg="MD5: PING PONG"; confBase=98; }
        else if (h[0]===h[1]&&h[1]===h[2]) { finalPred=h[0]; logicMsg="MD5: THEO BET"; confBase=98; }
        else { finalPred=h[0]===1?0:1; logicMsg="MD5: DAO NHIP"; confBase=98; isReversal=true; reversalFrom=h[0]===1?'TAI':'XIU'; }
    } else {
        let fastPred=-1, microPred=-1, v3Pred=-1, v4Pred=-1, v5Pred=-1, v6Pred=-1, v7Pred=-1, v11Pred=-1;
        let v3Msg="",v4Msg="",v5Msg="",v6Msg="",v7Msg="",v11Msg="";

        // V16
        let v16Pred=-1, v16Msg="";
        if (h.length>=7) {
            if (h[0]===h[3]&&h[1]===h[4]&&h[2]===h[5]) { v16Pred=h[0]===1?0:1; v16Msg="V16: DAO NHIP KEP LUONG TU"; }
            if (curStreak>=4&&(h[0]^h[4])===1) { v16Pred=h[0]===1?0:1; v16Msg="V16: EP BE BET GAY"; }
        }
        // V15
        let v15Pred=-1, v15Msg="";
        if (h.length>=15) {
            const xor=h[0]^h[2]^h[4], ent=(h[1]<<2)|(h[3]<<1)|h[5];
            if (xor===1&&ent>4&&curStreak<3) { v15Pred=1; v15Msg="V15: QUANTUM XOR->TAI"; }
            else if (xor===0&&ent<=4&&curStreak<3) { v15Pred=0; v15Msg="V15: QUANTUM XOR->XIU"; }
        }
        // V14
        let v14Pred=-1, v14Msg="";
        if (h.length>=6) {
            if (h[0]===h[1]&&h[1]!==h[2]&&h[2]!==h[3]&&h[3]!==h[4]) { v14Pred=h[0]; v14Msg="V14: BE PING PONG->OM BET"; }
            else if (h[0]!==h[1]&&h[1]!==h[2]&&h[2]===h[3]&&h[3]===h[4]) { v14Pred=h[0]; v14Msg="V14: BET TU CAU 1-1"; }
        }
        // V13
        let v13Pred=-1, v13Msg="";
        if (h.length>=10) {
            let changes=0; for(let i=0;i<9;i++){if(h[i]!==h[i+1])changes++;}
            if (changes<=3&&curStreak>=2) { v13Pred=h[0]; v13Msg="V13: BAM CAU TREND"; }
            else if (changes>=6) {
                if (h[0]===h[1]&&h[1]!==h[2]&&h[2]===h[3]) { v13Pred=h[0]; v13Msg="V13: DON BET CHUAN"; }
                else if (h[0]!==h[1]&&h[1]===h[2]&&h[2]!==h[3]) { v13Pred=h[0]===1?0:1; v13Msg="V13: CAT DAY LOAN"; isReversal=true; reversalFrom=h[0]===1?'TAI':'XIU'; }
            }
        }
        // V8
        let v8Pred=-1, v8Msg="", v8Conf=0;
        const v8m={3:1,4:0,5:1,6:0,7:0,8:1,9:0,10:0,11:0,12:1,13:1,14:0,15:1,16:0,17:1,18:1};
        const v8c={3:60,4:70,5:70,6:80,7:60,8:60,9:80,10:60,11:60,12:80,13:60,14:60,15:70,16:60,17:60,18:80};
        if (lastTotal>=3&&lastTotal<=18) { v8Pred=v8m[lastTotal]; v8Msg=`V8: TONG ${lastTotal}`; v8Conf=v8c[lastTotal]; }

        if (h.length>=6) {
            let rc=0; for(let i=0;i<3;i++){if(h[i]!==h[i+1])rc++;}
            if (rc===3) fastPred=h[0]===1?0:1;
            else if (h[1]===h[2]&&h[2]===h[3]&&h[0]!==h[1]) fastPred=h[0];
        }
        if (h.length>=5) {
            const score=(h[0]*5)+(h[1]*3)+(h[2]*2)+(h[3]*1)-(h[4]*1);
            if (score>6&&h[0]===1) microPred=1; else if (score<4&&h[0]===0) microPred=0;
        }
        if (h.length>=18&&h[0]===h[3]&&h[1]===h[4]&&h[2]===h[5]) { v3Pred=h[2]; v3Msg="V3: LAP CHU KY 3 NHIP"; }
        if (h.length>=20) {
            if (h[0]===h[4]&&h[1]===h[3]&&h[0]!==h[2]) { v4Pred=h[0]; v4Msg="V4: DOI XUNG GUONG TAM"; }
            else if (pStr.startsWith('100111')||pStr.startsWith('011000')) { v4Pred=h[0]===1?1:0; v4Msg="V4: THAP TIEN CAP"; }
            else if (h.slice(0,6).join('')===h.slice(6,12).join('')) { v4Pred=h[6]; v4Msg="V4: BAO LAP CHU KY 6"; }
        }
        if (curStreak>6) { v5Pred=h[0]===1?0:1; v5Msg="V5: DINH BET->BE"; isReversal=true; reversalFrom=h[0]===1?'TAI':'XIU'; }
        if (h.length>=30) {
            let pp=true; for(let i=0;i<8;i++){if(h[i]===h[i+1])pp=false;}
            if (pp) { v6Pred=h[0]===1?0:1; v6Msg="V6: PING PONG DAI HAN"; }
        }
        if (h.length>=15) {
            const xv=h[0]^h[1]^h[2], bs=(h[3]<<1)|h[4], re=(h[0]*8)+(h[1]*4)+(h[2]*2)+h[3];
            if (xv===1&&bs>1&&re>7) { v7Pred=1; v7Msg="V7: SUPER ENTROPY TAI"; }
            else if (xv===0&&bs<=1&&re<=7) { v7Pred=0; v7Msg="V7: SUPER ENTROPY XIU"; }
        }
        if (h.length>=12) {
            const ss=(h[0]+h[1]+h[2])/3, sm=(h[3]+h[4]+h[5]+h[6])/4;
            if (ss>0.6&&sm<0.4&&curStreak<2) { v11Pred=1; v11Msg="V11: LECH CHUAN->TAI"; }
            else if (ss<0.4&&sm>0.6&&curStreak<2) { v11Pred=0; v11Msg="V11: LECH CHUAN->XIU"; }
        }

        // TONG HOP
        if (daoNhip4!==-1) { finalPred=daoNhip4; }
        else if (ev.tai>ev.xiu+2&&v16Pred===-1&&v15Pred===-1) { finalPred=1; logicMsg=`AI DONG THUAN TAI (${ev.tai}/${ev.tai+ev.xiu})`; confBase=95+Math.min(ev.tai,4); }
        else if (ev.xiu>ev.tai+2&&v16Pred===-1&&v15Pred===-1) { finalPred=0; logicMsg=`AI DONG THUAN XIU (${ev.xiu}/${ev.tai+ev.xiu})`; confBase=95+Math.min(ev.xiu,4); }
        else if (v16Pred!==-1) { finalPred=v16Pred; logicMsg=v16Msg; confBase=99; isReversal=true; reversalFrom=h[0]===1?'TAI':'XIU'; }
        else if (v15Pred!==-1) { finalPred=v15Pred; logicMsg=v15Msg; confBase=99; }
        else if (v14Pred!==-1) { finalPred=v14Pred; logicMsg=v14Msg; confBase=99; }
        else if (v13Pred!==-1) { finalPred=v13Pred; logicMsg=v13Msg; confBase=99; }
        else if (v11Pred!==-1) { finalPred=v11Pred; logicMsg=v11Msg; confBase=99; }
        else if (v8Pred!==-1) { finalPred=v8Pred; logicMsg=v8Msg; confBase=v8Conf; }
        else if (v7Pred!==-1) { finalPred=v7Pred; logicMsg=v7Msg; confBase=99; }
        else if (v6Pred!==-1) { finalPred=v6Pred; logicMsg=v6Msg; confBase=99; }
        else if (v5Pred!==-1) { finalPred=v5Pred; logicMsg=v5Msg; confBase=99; }
        else if (v4Pred!==-1) { finalPred=v4Pred; logicMsg=v4Msg; confBase=99; }
        else if (v3Pred!==-1) { finalPred=v3Pred; logicMsg=v3Msg; confBase=98; }
        else if (fastPred!==-1) { finalPred=fastPred; logicMsg="VIP9: BAT NGUYEN TU NHANH"; confBase=95; }
        else if (microPred!==-1&&curStreak<=3) { finalPred=microPred; logicMsg="VIP10: SIEU TRONG SO"; confBase=94; }
        else { finalPred=h[0]===1?0:1; logicMsg="DAO NHIP TIEU CHUAN VIP"; confBase=85; }
    }

    if (finalPred === -1) return { prediction: null, confidence: 0, logic: logicMsg, isReversal: false };

    const conf = Math.min(Math.max(confBase + (h[0]===h[1]&&curStreak<3?2:0), 65), 99);
    return {
        prediction: finalPred === 1 ? 'TAI' : 'XIU',
        confidence: conf,
        logic: logicMsg,
        isReversal,
        reversalFrom: isReversal ? reversalFrom : null,
        lastTotal,
        recentHistory: h.slice(0,10).map(v=>v===1?'T':'X').join('')
    };
}

// ==================== FETCH LOOP ====================
async function fetchAndUpdate(gameId) {
    const g = GAMES[gameId];
    const s = state[gameId];
    try {
        const res = await fetch(g.api, {timeout: 5000});
        const json = await res.json();
        const list = json.list || json.data || (Array.isArray(json) ? json : []);
        if (!list || list.length === 0) return;
        const latest = list[0];
        s.lastTotal = (latest.dice1||0)+(latest.dice2||0)+(latest.dice3||0);
        s.history = list.slice(0, 605).map(x => {
            const sum = (x.dice1||0)+(x.dice2||0)+(x.dice3||0);
            return (sum===0&&x.resultTruyenThong)?(x.resultTruyenThong==='TAI'?1:0):(sum>10?1:0);
        });
        if (latest.id > s.lastPhien) {
            s.lastPhien = latest.id;
            s.lastResult = deepAnalysis(s.history, gameId, s.lastTotal, s.lastPhien);
            s.updatedAt = new Date().toISOString();
            console.log(`[${gameId}] Phien #${latest.id+1} -> ${s.lastResult.prediction} (${s.lastResult.confidence}%) | ${s.lastResult.logic}`);
        }
    } catch(e) {
        console.error(`[${gameId}] Error:`, e.message);
    }
}

setInterval(() => fetchAndUpdate('lc79_hu'), 3000);
setInterval(() => fetchAndUpdate('lc79_md5'), 3000);
fetchAndUpdate('lc79_hu');
fetchAndUpdate('lc79_md5');

// ==================== ROUTES ====================
app.get('/', (req, res) => {
    res.json({ status: 'online', routes: ['/predict/lc79_hu', '/predict/lc79_md5', '/predict/all'] });
});
app.get('/predict/all', (req, res) => {
    res.json({
        lc79_hu:  { game: GAMES.lc79_hu.name,  phien: state.lc79_hu.lastPhien+1,  historyCount: state.lc79_hu.history.length,  updatedAt: state.lc79_hu.updatedAt,  ...state.lc79_hu.lastResult  },
        lc79_md5: { game: GAMES.lc79_md5.name, phien: state.lc79_md5.lastPhien+1, historyCount: state.lc79_md5.history.length, updatedAt: state.lc79_md5.updatedAt, ...state.lc79_md5.lastResult }
    });
});
app.get('/predict/:gameId', (req, res) => {
    const {gameId} = req.params;
    if (!state[gameId]) return res.status(404).json({error: 'Not found. Use: lc79_hu or lc79_md5'});
    const s = state[gameId];
    res.json({ game: GAMES[gameId].name, phien: s.lastPhien+1, historyCount: s.history.length, updatedAt: s.updatedAt, ...s.lastResult });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
