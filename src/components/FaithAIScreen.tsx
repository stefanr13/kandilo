import { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Send, Sparkles, User, Bot, Globe } from 'lucide-react';
import { Language } from '../types';
import { TRANSLATIONS } from '../translations';
import { sendFaithAiChat } from '../lib/api/ai';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface FaithAIScreenProps {
  language: Language;
}

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'sr', name: 'Srpski' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'ro', name: 'Română' }
];

export default function FaithAIScreen({ language: globalLanguage }: FaithAIScreenProps) {
  const t = TRANSLATIONS[globalLanguage].faith;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: t.description
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Map global language to local code
  const getInitialLangCode = () => {
    switch (globalLanguage) {
      case 'Srpski (Latinica)':
      case 'Srpski (Ćirilica)': return 'sr';
      case 'Русский': return 'ru';
      case 'Українська': return 'uk';
      case 'Română': return 'ro';
      default: return 'en';
    }
  };

  const [language, setLanguage] = useState(getInitialLangCode());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Update local language when global changes
  useEffect(() => {
    setLanguage(getInitialLangCode());
  }, [globalLanguage]);

  const handleSend = async (text?: string) => {
    const messageText = text || input;
    if (!messageText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
    };

    const historyForCloud = messages
      .filter((m) => m.id !== '1')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.content } as { role: 'user' | 'model'; text: string }));

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const result = await sendFaithAiChat({ message: messageText, history: historyForCloud });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.text || 'I apologize, I am unable to provide an answer at this time. Please try again later.',
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Faith AI error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Faith AI is temporarily unavailable. Please try again later or speak with your priest.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full bg-white"
    >
      {/* Header */}
      <div className="px-8 pt-12 pb-6 border-b border-gray-50 flex items-center justify-between sticky top-0 bg-white z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-[#800000] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-red-900/20">
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className="text-xl font-black text-gray-900 tracking-tight">{t.title}</h1>
            <p className="text-[10px] font-bold text-[#937022] uppercase tracking-widest">Spiritual Companion</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-gray-400" />
          <select 
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="text-[10px] font-black uppercase tracking-widest text-gray-900 bg-gray-50 border-none rounded-lg px-2 py-1 focus:ring-0"
          >
            {LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-8 lg:px-16 lg:py-10 space-y-8 scrollbar-hide">
        {messages.length === 1 && (
          <div className="space-y-4 lg:max-w-3xl lg:mx-auto">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t.suggestions}</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {[t.suggestion1, t.suggestion2, t.suggestion3, t.suggestion4].map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(s)}
                  className="text-left p-4 bg-gray-50 rounded-2xl text-xs font-bold text-gray-700 hover:bg-gray-100 transition-all border border-transparent hover:border-gray-200"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-4 lg:max-w-3xl lg:mx-auto ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
              message.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-50 text-[#937022]'
            }`}>
              {message.role === 'user' ? <User size={20} /> : <Bot size={20} />}
            </div>
            <div className={`max-w-[80%] p-6 rounded-3xl text-sm leading-relaxed ${
              message.role === 'user' 
                ? 'bg-gray-900 text-white rounded-tr-none' 
                : 'bg-gray-50 text-gray-900 rounded-tl-none'
            }`}>
              {message.content}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-4 lg:max-w-3xl lg:mx-auto"
          >
            <div className="w-10 h-10 rounded-2xl bg-gray-50 flex items-center justify-center text-[#937022]">
              <Bot size={20} />
            </div>
            <div className="bg-gray-50 p-6 rounded-3xl rounded-tl-none">
              <div className="flex gap-1">
                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
                <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-gray-300 rounded-full" />
              </div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-8 lg:px-16 border-t border-gray-50">
        <div className="relative lg:max-w-3xl lg:mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t.placeholder}
            className="w-full bg-gray-50 border-none rounded-3xl pl-8 pr-16 py-6 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className={`absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
              input.trim() && !isLoading ? 'bg-[#800000] text-white shadow-lg shadow-red-900/20' : 'bg-gray-200 text-gray-400'
            }`}
          >
            <Send size={20} />
          </button>
        </div>
        <p className="text-[10px] text-center text-gray-400 font-bold mt-4 uppercase tracking-widest">
          {t.disclaimer}
        </p>
      </div>
    </motion.div>
  );
}
