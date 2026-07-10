globalThis.__yttbAnalyzeTrailingNonSpeech = async (...args) => {
    const module = await import('./trailing-vad-analyzer.js');
    return module.analyzeTrailingNonSpeech(...args);
};
