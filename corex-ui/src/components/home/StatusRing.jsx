const StatusRing = ({ label, subLabel, status }) => {
  const isOk = status === "CONNECTED" || status === "READY" || status === "OPERATIONAL";
  
  return (
    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col items-center justify-center text-center">
      <div className={`h-16 w-16 rounded-full border-4 flex items-center justify-center mb-3 transition-all duration-500 ${
        isOk ? 'border-green-500/20 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]' 
             : 'border-red-500/20 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
      }`}>
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isOk ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          )}
        </svg>
      </div>
      <h4 className="text-sm font-bold">{label}</h4>
      <p className="text-[10px] text-slate-500 uppercase tracking-tighter">{subLabel}</p>
    </div>
  );
};

export default StatusRing;