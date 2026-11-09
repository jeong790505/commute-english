// 초급자용 상황별 시나리오. phrases = 이번 레슨에서 꼭 익힐 핵심 표현.
export const SCENARIOS = [
  { id: "intro", ko: "자기소개", en: "Introducing yourself",
    goal: "Say your name, job, and one hobby.",
    phrases: ["Hi, I'm ___.", "Nice to meet you.", "I work at ___.", "I like ___ in my free time."] },
  { id: "cafe", ko: "카페 주문", en: "Ordering at a cafe",
    goal: "Order a drink, choose size, and pay.",
    phrases: ["Can I get an iced americano?", "A large one, please.", "For here, please. / To go, please.", "Can I pay by card?"] },
  { id: "restaurant", ko: "식당", en: "At a restaurant",
    goal: "Get a table, order food, and ask for the bill.",
    phrases: ["A table for two, please.", "What do you recommend?", "I'll have this one.", "Can I get the check, please?"] },
  { id: "directions", ko: "길 묻기", en: "Asking for directions",
    goal: "Ask how to get somewhere and confirm.",
    phrases: ["Excuse me, where is the subway station?", "How long does it take?", "Is it far from here?", "Could you say that again?"] },
  { id: "smalltalk", ko: "회사 스몰토크", en: "Small talk at work",
    goal: "Chat with a coworker about the weekend.",
    phrases: ["How was your weekend?", "It was good. I just relaxed.", "What did you do?", "Sounds fun!"] },
  { id: "weather", ko: "날씨 이야기", en: "Talking about the weather",
    goal: "Describe today's weather and how you feel.",
    phrases: ["It's really cold today.", "It looks like rain.", "I love this weather.", "I'm so tired today."] },
  { id: "shopping", ko: "쇼핑", en: "Shopping for clothes",
    goal: "Ask for a size, try something on, and ask the price.",
    phrases: ["Do you have this in a medium?", "Can I try this on?", "How much is this?", "I'll take it."] },
  { id: "hotel", ko: "호텔 체크인", en: "Hotel check-in",
    goal: "Check in and ask about breakfast and Wi-Fi.",
    phrases: ["I have a reservation under ___.", "What time is breakfast?", "What's the Wi-Fi password?", "What time is check-out?"] },
  { id: "airport", ko: "공항", en: "At the airport",
    goal: "Check in for a flight and answer basic questions.",
    phrases: ["I'd like a window seat, please.", "I have one bag to check.", "Where is gate 12?", "I'm here for vacation."] },
  { id: "taxi", ko: "택시 타기", en: "Taking a taxi",
    goal: "Tell the driver where to go and pay.",
    phrases: ["To ___, please.", "How long will it take?", "Can you stop here, please?", "Keep the change."] },
  { id: "phone", ko: "전화 예약", en: "Making a reservation by phone",
    goal: "Book a table for a specific day and time.",
    phrases: ["I'd like to make a reservation.", "For Friday at 7, please.", "For four people.", "Can I change my reservation?"] },
  { id: "hospital", ko: "병원/약국", en: "At the pharmacy",
    goal: "Explain a simple symptom and ask for medicine.",
    phrases: ["I have a headache.", "I have a sore throat.", "Do you have something for a cold?", "How often should I take it?"] },
  { id: "free", ko: "자유 대화", en: "Free talk",
    goal: "Talk freely about your day, food, and plans.",
    phrases: ["Today I ___.", "I'm going to ___ this weekend.", "My favorite food is ___.", "What about you?"] },
];

export function todayScenario(date = new Date()) {
  const fixed = SCENARIOS.filter(s => s.id !== "free");
  const dayIndex = Math.floor(date.getTime() / 86400000);
  return fixed[dayIndex % fixed.length];
}
