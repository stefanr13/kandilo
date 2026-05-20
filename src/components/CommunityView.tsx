import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Search, ChevronRight, Mail, Phone, ArrowLeft, Users, MessageSquare, Loader2, Shield } from 'lucide-react';
import { motion } from 'motion/react';
import { Language } from '../types';
import { TRANSLATIONS } from '../translations';
import { subscribeToChurchMembers, type FirestoreMember } from '../lib/db/memberships';

type Category = 'All' | 'Ministries' | 'Parishioners';

interface CommunityViewProps {
  language?: Language;
  churchId: string | null;
}

interface CommunityEntry {
  id: string;
  name: string;
  role: string;
  category: Exclude<Category, 'All'>;
  blurb: string;
  description: string;
  email: string;
  phone: string;
  avatar: string;
  initial: string;
}

function memberRoleLabel(member: FirestoreMember): string {
  if (member.role === 'priest') return 'Priest';
  if (member.role === 'admin') return 'Parish Admin';
  if (member.ministry) return member.ministry;
  return 'Parishioner';
}

function memberCategory(member: FirestoreMember): Exclude<Category, 'All'> {
  return member.role === 'priest' || member.role === 'admin' || Boolean(member.ministry)
    ? 'Ministries'
    : 'Parishioners';
}

function toCommunityEntry(member: FirestoreMember): CommunityEntry {
  const name = member.displayName || 'Parishioner';
  const role = memberRoleLabel(member);
  const description = member.description?.trim() || `${name} is part of the parish community.`;

  return {
    id: member.id,
    name,
    role,
    category: memberCategory(member),
    blurb: member.description?.trim() || role,
    description,
    email: member.email,
    phone: member.phone ?? '',
    avatar: member.photoURL,
    initial: name.charAt(0).toUpperCase(),
  };
}

export default function CommunityView({ language = 'English', churchId }: CommunityViewProps) {
  const [selectedCategory, setSelectedCategory] = useState<Category>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMember, setSelectedMember] = useState<CommunityEntry | null>(null);
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<FirestoreMember[]>([]);
  const [loading, setLoading] = useState(true);

  const t = TRANSLATIONS[language].community;

  useEffect(() => {
    if (!churchId) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToChurchMembers(churchId, (nextMembers) => {
      setMembers(nextMembers);
      setLoading(false);
    });
    return unsubscribe;
  }, [churchId]);

  useEffect(() => {
    setSelectedMember(null);
    setExpandedMembers(new Set());
  }, [churchId]);

  const categories: { id: Category; label: string }[] = [
    { id: 'All', label: t.categoryAll },
    { id: 'Ministries', label: t.categoryMinistries },
    { id: 'Parishioners', label: t.categoryParishioners },
  ];

  const toggleExpand = (event: MouseEvent, memberId: string) => {
    event.stopPropagation();
    const nextExpanded = new Set(expandedMembers);
    if (nextExpanded.has(memberId)) {
      nextExpanded.delete(memberId);
    } else {
      nextExpanded.add(memberId);
    }
    setExpandedMembers(nextExpanded);
  };

  useEffect(() => {
    const scrollContainer = document.querySelector('main');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [selectedMember]);

  const community = useMemo(() => {
    return members
      .filter((member) => member.status === 'active' && member.showInDirectory !== false)
      .map(toCommunityEntry)
      .sort((a, b) => {
        if (a.category !== b.category) return a.category === 'Ministries' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [members]);

  const filteredCommunity = useMemo(() => {
    const searchLower = searchQuery.trim().toLowerCase();
    return community.filter((member) => {
      const matchesCategory = selectedCategory === 'All' || member.category === selectedCategory;
      const matchesSearch =
        !searchLower ||
        member.name.toLowerCase().includes(searchLower) ||
        member.role.toLowerCase().includes(searchLower);
      return matchesCategory && matchesSearch;
    });
  }, [community, selectedCategory, searchQuery]);

  const avatar = (member: CommunityEntry, sizeClass: string) => (
    <div className={`${sizeClass} rounded-[28px] bg-gray-100 overflow-hidden border border-gray-50 flex-shrink-0 shadow-inner flex items-center justify-center text-gray-400 font-black`}>
      {member.avatar ? (
        <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span>{member.initial}</span>
      )}
    </div>
  );

  if (!churchId) {
    return (
      <div className="p-8 pb-24 lg:w-full lg:max-w-6xl lg:mx-auto lg:px-10 lg:pt-8">
        <div className="text-center py-20">
          <Users size={40} className="text-gray-200 mx-auto mb-4" />
          <h3 className="font-black text-gray-900">No parish selected</h3>
          <p className="text-sm text-gray-400 mt-2">Join a parish to view its community directory.</p>
        </div>
      </div>
    );
  }

  if (selectedMember) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="bg-white min-h-full pb-24"
      >
        <div className="px-6 pt-6">
          <button
            onClick={() => setSelectedMember(null)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={18} />
            <span className="text-sm font-bold">Back</span>
          </button>
        </div>

        <div className="lg:hidden">
          <div className="relative h-48 w-full mt-4 bg-gray-50">
            {selectedMember.avatar ? (
              <>
                <img src={selectedMember.avatar} alt="" className="w-full h-full object-cover blur-sm opacity-50" referrerPolicy="no-referrer" />
                <div className="absolute inset-0 bg-gradient-to-t from-white via-white/40 to-transparent" />
              </>
            ) : null}
            <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center translate-y-1/2 px-8 z-10">
              {avatar(selectedMember, 'w-28 h-28 text-4xl')}
            </div>
          </div>
          <div className="pt-18 px-8 text-center mt-16">
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{selectedMember.name}</h2>
            <div className="mt-2 flex items-center justify-center gap-2 text-[#937022] font-black text-[10px] uppercase tracking-widest">
              <Users size={12} />{selectedMember.role}
            </div>
            <div className="mt-8 text-left space-y-6">
              <div>
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-3">{t.descriptionLabel}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{selectedMember.description}</p>
              </div>
              <div>
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-3">{t.contactInfo}</h3>
                <div className="space-y-3">
                  <a href={`mailto:${selectedMember.email}`} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#937022] shadow-sm"><Mail size={20} /></div>
                    <span className="text-sm font-bold text-gray-700 break-all">{selectedMember.email}</span>
                  </a>
                  {selectedMember.phone && (
                    <a href={`tel:${selectedMember.phone}`} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl">
                      <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#937022] shadow-sm"><Phone size={20} /></div>
                      <span className="text-sm font-bold text-gray-700">{selectedMember.phone}</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-10">
              <a href={`mailto:${selectedMember.email}`} className="w-full py-5 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-black/10 hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-3">
                <MessageSquare size={18} />{t.sendMessage}
              </a>
            </div>
          </div>
        </div>

        <div className="hidden lg:grid lg:w-full lg:max-w-5xl lg:mx-auto lg:grid-cols-[300px_1fr] lg:gap-10 lg:px-10 lg:pt-6">
          <div className="flex flex-col items-center text-center">
            {avatar(selectedMember, 'w-40 h-40 text-5xl')}
            <h2 className="mt-6 text-3xl font-black text-gray-900 tracking-tighter">{selectedMember.name}</h2>
            <div className="mt-2 flex items-center gap-2 text-[#937022] font-black text-[10px] uppercase tracking-widest">
              <Users size={12} />{selectedMember.role}
            </div>
            <div className="mt-2">
              <span className="px-3 py-1.5 bg-gray-50 rounded-xl text-[10px] font-bold text-gray-500 uppercase tracking-widest">{selectedMember.category}</span>
            </div>

            <div className="mt-8 w-full space-y-3">
              <a href={`mailto:${selectedMember.email}`} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl text-left">
                <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center text-[#937022] shadow-sm flex-shrink-0"><Mail size={18} /></div>
                <span className="text-sm font-bold text-gray-700 truncate">{selectedMember.email}</span>
              </a>
              {selectedMember.phone && (
                <a href={`tel:${selectedMember.phone}`} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl text-left">
                  <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center text-[#937022] shadow-sm flex-shrink-0"><Phone size={18} /></div>
                  <span className="text-sm font-bold text-gray-700">{selectedMember.phone}</span>
                </a>
              )}
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">{t.descriptionLabel}</h3>
              <p className="text-gray-600 text-base leading-relaxed">{selectedMember.description}</p>
            </div>

            <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
              <p className="text-sm italic text-gray-500 leading-relaxed">"{selectedMember.blurb}"</p>
            </div>

            <a href={`mailto:${selectedMember.email}`} className="w-full py-5 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-black/10 hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-3">
              <MessageSquare size={18} />{t.sendMessage}
            </a>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="p-8 pb-24 lg:w-full lg:max-w-7xl lg:mx-auto lg:px-10 lg:pt-8"
    >
      <div className="flex justify-between items-center mb-6">
        <div>
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">Parish Life</span>
          <h1 className="text-4xl font-black text-gray-900 tracking-tighter leading-none">{t.title}</h1>
        </div>
      </div>

      <div className="mb-8">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-gray-100 rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#800000]/20 shadow-sm"
          />
        </div>
      </div>

      <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-5 py-2.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${
              selectedCategory === cat.id ? 'bg-gray-900 text-white shadow-lg' : 'bg-white text-gray-500 border border-gray-100'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="text-[#800000] animate-spin" />
        </div>
      ) : filteredCommunity.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCommunity.map((member) => {
            const isExpanded = expandedMembers.has(member.id);
            return (
              <div
                key={member.id}
                onClick={() => setSelectedMember(member)}
                className="bg-white rounded-[32px] p-6 border border-gray-50 shadow-sm hover:shadow-md transition-all cursor-pointer group active:scale-[0.98]"
              >
                <div className="flex gap-6">
                  {avatar(member, 'w-24 h-24 text-3xl')}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex justify-between items-start gap-3">
                      <h4 className="font-black text-gray-900 text-xl tracking-tight leading-tight">{member.name}</h4>
                      <ChevronRight size={20} className="text-gray-200 group-hover:text-gray-400 transition-colors flex-shrink-0" />
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2 text-[#937022] font-black text-[10px] uppercase tracking-widest">
                        {member.category === 'Ministries' ? <Shield size={12} /> : <Users size={12} />}
                        {member.role}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <p className={`text-[12px] text-gray-500 font-medium italic leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                    "{member.blurb}"
                  </p>
                  {member.blurb.length > 80 && (
                    <button
                      onClick={(event) => toggleExpand(event, member.id)}
                      className="text-[#937022] text-[10px] font-black uppercase tracking-widest mt-2 hover:underline"
                    >
                      {isExpanded ? t.showLess : t.readMore}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mx-auto mb-4">
            <Search size={32} />
          </div>
          <h3 className="font-bold text-gray-900">{community.length === 0 ? 'No directory entries yet' : t.noResults}</h3>
          <p className="text-xs text-gray-400 mt-1">
            {community.length === 0 ? 'Members can opt into the directory from their profile.' : t.adjustSearch}
          </p>
        </div>
      )}
    </motion.div>
  );
}
