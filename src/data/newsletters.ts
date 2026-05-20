export interface Newsletter {
  id: number;
  title: string;
  date: string;
  excerpt: string;
  imageUrl: string;
  readTime: string;
  content?: string;
}

export const NEWSLETTERS: Newsletter[] = [
  {
    id: 1,
    title: "The Meaning of the Divine Liturgy",
    date: "April 5, 2026",
    excerpt: "A deep dive into the symbolism and spiritual significance of the central service of the Orthodox Church...",
    imageUrl: "https://picsum.photos/seed/liturgy/800/400",
    readTime: "5 min read"
  },
  {
    id: 2,
    title: "Preparing for Great Lent",
    date: "March 15, 2026",
    excerpt: "Practical tips and spiritual guidance for the upcoming fasting season and journey to Pascha...",
    imageUrl: "https://picsum.photos/seed/lent/800/400",
    readTime: "8 min read"
  },
  {
    id: 3,
    title: "The Lives of the Saints: St. John of Damascus",
    date: "March 1, 2026",
    excerpt: "Exploring the life and legacy of the great defender of icons and theologian of the Church.",
    imageUrl: "https://picsum.photos/seed/saint/800/400",
    readTime: "6 min read"
  },
  {
    id: 4,
    title: "Parish Expansion Project Update",
    date: "February 15, 2026",
    excerpt: "An update on our fundraising and planning for the new community center and educational wing.",
    imageUrl: "https://picsum.photos/seed/church/800/400",
    readTime: "10 min read"
  }
];
