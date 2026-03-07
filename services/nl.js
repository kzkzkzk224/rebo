export async function searchNationalLibraryBooks({ apiKey }) {
  // MVP에서는 알라딘 우선 동작. NL은 이후 확장을 위한 자리.
  if (!apiKey) {
    return {
      items: [],
      warnings: ["환경변수 NL_API_KEY가 설정되지 않아 국립중앙도서관 보강은 건너뜁니다."],
    };
  }

  return {
    items: [],
    warnings: ["국립중앙도서관 보강 기능은 다음 단계에서 활성화됩니다."],
  };
}
