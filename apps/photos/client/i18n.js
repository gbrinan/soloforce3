// mycrew-photos i18n — vanilla JS, single-module, inline dictionary
// localStorage key 'jarvis-lang' shared with mycrew-system (ko/en/ja)
// Synchronous module — no async fetch, no flash of untranslated content.

(function () {
  'use strict';

  var LOCALES = ['ko', 'en', 'ja'];
  var STORAGE_KEY = 'jarvis-lang';

  var dict = {
    ko: {
      // navigation
      'nav.library': '라이브러리',
      'nav.map': '지도',
      'nav.favorites': '즐겨찾기',
      'nav.archived': '보관함',
      'nav.trash': '휴지통',
      'nav.albums': '앨범',
      'nav.people': '인물',
      'nav.documents': '문서',
      'nav.screenshots': '스크린샷',
      'nav.tags': '태그',
      'nav.businesscards': '명함',

      // common
      'common.add': '추가',
      'common.delete': '삭제',
      'common.cancel': '취소',
      'common.confirm': '확인',
      'common.close': '닫기',
      'common.back': '뒤로',
      'common.edit': '편집',
      'common.rename': '이름 변경',
      'common.copy': '복사',
      'common.restore': '복원',
      'common.permanentDelete': '영구삭제',
      'common.upload': '⬆ 업로드',
      'common.selectMode': '✓ 선택 모드',
      'common.selectModeOn': '✓ 선택 모드 (켜짐)',
      'common.or': '또는',
      'common.selectedCount': '${count}개 선택됨',
      'common.unspecified': '미지정',
      'common.top': '상단',

      // page titles (used in titles map)
      'pageTitle.library': '📷 라이브러리',
      'pageTitle.favorites': '⭐ 즐겨찾기',
      'pageTitle.archive': '📦 보관함',
      'pageTitle.trash': '🗑️ 휴지통',
      'pageTitle.map': '🗺️ 지도',
      'pageTitle.albums': '📂 앨범',
      'pageTitle.people': '👤 인물',
      'pageTitle.documents': '📄 문서',
      'pageTitle.screenshots': '📱 스크린샷',
      'pageTitle.personDetail': '👤 ${name}',

      // topbar buttons
      'btn.themeToggle': '테마 전환',
      'btn.settings': '⚙️ 설정',
      'btn.importFolder': '📁 폴더 가져오기',
      'btn.addToAlbum': '📂 앨범에 추가',
      'btn.toggleFavorite': '⭐ 즐겨찾기',
      'btn.toggleArchive': '📦 보관함',
      'btn.batchTrash': '🗑️ 휴지통',
      'btn.batchOcrDoc': '📝 OCR 문서화',
      'btn.batchMail': '✉️ 메일로 보내기',
      'btn.cancel': '취소',
      'btn.start': '시작',
      'ocrDoc.title': '📝 OCR 문서화',
      'ocrDoc.desc': '선택한 <b>{count}장</b>의 텍스트를 추출해 문서로 다운로드하고 외부 자료실(마이크루 본체)에 자동 추가합니다. 사진 수에 따라 수십 초~수 분 소요됩니다.',
      'ocrDoc.labelTitle': '제목 (선택)',
      'ocrDoc.placeholderTitle': 'OCR 문서 제목',
      'ocrDoc.labelFormat': '포맷',
      'ocrDoc.optPdf': 'PDF (검색 가능, 기본값)',
      'ocrDoc.optMd': 'Markdown (.md)',
      'ocrDoc.optTxt': '텍스트 (.txt)',
      'ocrDoc.optXlsx': 'Excel (.xlsx)',
      'btn.ok': '확인',
      'albumPicker.title': '앨범 선택',
      'albumPicker.newLabel': '+ 새 앨범 만들기',
      'albumPicker.newPlaceholder': '새 앨범 이름',
      'zoom.label': '썸네일 크기',
      'zoom.in': '확대',
      'zoom.out': '축소',
      'btn.lightboxClose': '닫기 (ESC)',
      'btn.newAlbum': '+ 새 앨범',
      'btn.createNewAlbum': '새 앨범 만들기',
      'btn.addPhotosToAlbum': '+ 사진 추가',
      'btn.backToAlbums': '← 뒤로',
      'btn.backToPeople': '← 인물 목록',
      'btn.renamePerson': '✏️ 이름 변경',
      'btn.detailView': '상세 보기',
      'btn.copy': '📋 복사',
      'btn.shareCreate': '공개 링크 생성',
      'btn.runReceiptOcr': '📝 영수증 OCR 실행',
      'btn.runReceiptOcrRetry': '📝 영수증 OCR 재실행',
      'btn.runPlateOcr': '🚗 번호판 OCR 실행',
      'btn.runPlateOcrRetry': '🚗 번호판 OCR 재실행',
      'btn.done': '✓ 완료',
      'btn.processing': '처리 중...',

      // search placeholders
      'search.ocrPlaceholder': 'OCR 텍스트...',
      'search.tagPlaceholder': '태그...',
      'search.cameraPlaceholder': '카메라...',
      'search.unifiedPlaceholder': '검색: OCR / 태그 / 카메라...',
      'search.tagInputPlaceholder': '태그 입력 후 Enter',

      // empty states
      'empty.noPhotosTitle': '사진이 아직 없습니다',
      'empty.noPhotosHint': '상단 <b>폴더 가져오기</b> 또는 <b>업로드</b>로 시작하세요.',
      'empty.noDocumentsTitle': '문서로 인식된 사진이 없습니다',
      'empty.noDocumentsHint': '촬영한 문서는 업로드 직후 자동 인식돼 여기에 추가됩니다. 기존 사진을 일괄 분석하려면 아래 버튼을 누르세요.',
      'btn.runDocOcr': '기존 사진 일괄 분석',
      'btn.removeFromCategory': '카테고리에서 제거',
      'msg.docOcrRunning': '분석 중... (최대 1~3분)',
      'msg.docOcrDone': '완료: {scanned}장 분석, {classified}장이 문서로 추가됨',
      'msg.docOcrNoCandidate': '분석 대상 사진이 없습니다',
      'empty.noAlbums': '앨범이 없습니다',
      'empty.albumEmpty': '앨범에 사진이 없습니다',
      'empty.noPeople': '등록된 인물이 없습니다',
      'empty.peopleHint': '사진에서 얼굴을 감지하면 자동으로 인물이 생성됩니다',
      'empty.noGps': 'GPS 정보가 있는 사진이 없습니다',
      'empty.noTags': '태그 없음',
      'empty.noShareLink': '공개 링크 없음',
      'empty.noWatchedFolders': '감시 중인 폴더 없음',
      'empty.noInfo': '정보 없음',
      'empty.ocrIdle': 'OCR 미실행 상태',
      'empty.dateUnknown': '날짜 미상',

      // counts
      'count.photos': '${count}장',
      'count.yearsAgo': '${years}년 전',
      'count.yearMonth': '${year}년 ${month}월',

      // sections
      'section.shootingInfo': '촬영 정보',
      'section.cameraSettings': '카메라 설정',
      'section.location': '위치',
      'section.ocrTitle': '텍스트 인식 (OCR)',
      'section.rating': '⭐ 별점',
      'section.tags': '🏷️ 태그',
      'section.sharePublicLink': '🔗 공개 링크',
      'section.memories': '💭 추억',
      'section.settingsTitle': '⚙️ 설정',
      'section.watchedFolders': '📁 외부 폴더 자동 감시',
      'section.language': '🌐 언어',
      'section.theme': '🎨 테마',
      'settings.themeLight': '☀️ 라이트',
      'settings.themeDark': '🌙 다크',
      'btn.sidebarToggle': '사이드바 접기/펼치기',

      // EXIF
      'exif.date': '촬영일',
      'exif.location': '위치',
      'exif.camera': '카메라',
      'exif.lens': '렌즈',
      'exif.shutter': '셔터',
      'exif.aperture': '조리개',
      'exif.focalLength': '초점거리',
      'exif.coordinates': '좌표',
      'exif.filename': '파일명',
      'exif.size': '크기',
      'exif.loadFailed': 'EXIF 로드 실패',

      // OCR
      'ocr.receiptHeader': '영수증 텍스트:',
      'ocr.plateLabel': '번호판:',
      'ocr.empty': '(없음)',
      'ocr.plateFailedPrefix': '번호판: 실패 - ${error}',

      // share
      'share.passwordPlaceholder': '비밀번호 (선택)',

      // watched
      'watched.pathPlaceholder': '폴더 경로 (예: ~/Photos)',

      // prompts
      'prompt.newPersonName': '새 이름을 입력하세요:',
      'prompt.albumRename': '앨범 이름 변경',
      'prompt.newAlbumName': '새 앨범 이름을 입력하세요',
      'prompt.albumChoice': '앨범을 선택하세요 (번호 입력) 또는 0 입력 시 새 앨범 생성:\n${list}',
      'prompt.importFolderPath': '가져올 폴더 경로를 입력하세요\n예: ~/Pictures',

      // confirms
      'confirm.deleteAlbum': '앨범을 삭제하시겠습니까? (사진은 보존됩니다)',
      'confirm.permanentDelete': '정말로 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
      'confirm.trashMove': '${count}장을 휴지통으로 이동하시겠습니까?',

      // toasts (success)
      'toast.renamed': '✓ 이름 변경됨: ${name}',
      'toast.albumRenamed': '앨범 이름 변경 완료',
      'toast.albumDeleted': '앨범 삭제 완료',
      'toast.albumCreated': '앨범 생성 완료',
      'toast.photoRemoved': '사진 제거 완료',
      'toast.favoriteAdded': '⭐ 즐겨찾기 추가',
      'toast.favoriteRemoved': '즐겨찾기 제거',
      'toast.archived': '📦 보관함으로 이동',
      'toast.archiveUndone': '보관 취소',
      'toast.trashed': '🗑️ 휴지통으로 이동',
      'toast.removedFromCategory': '✕ 카테고리에서 제거됨',
      'toast.restored': '✅ 복원 완료',
      'toast.permanentDeleted': '🗑️ 영구 삭제 완료',
      'toast.favoriteBatchDone': '즐겨찾기 처리 완료 (${count}장)',
      'toast.archiveBatchDone': '보관함 처리 완료 (${count}장)',
      'toast.trashBatchDone': '휴지통 이동 완료 (${count}장)',
      'toast.selectModeHint': '선택 모드로 전환하여 사진을 선택한 후 앨범에 추가하세요',
      'toast.selectPhotos': '사진을 선택하세요',
      'toast.invalidChoice': '잘못된 선택입니다',
      'toast.addedToNewAlbum': '${count}장을 새 앨범에 추가했습니다',
      'toast.addedToAlbum': '${count}장을 "${name}"에 추가했습니다',
      'toast.folderScanning': '폴더 스캔 중...',
      'toast.folderImportDone': '완료: ${imported}장 가져옴, ${skipped}장 건너뜀',
      'toast.uploading': '업로드 중... (${count}장)',
      'toast.uploadDone': '업로드 완료: ${count}장 추가',
      'toast.tagRemoved': '🏷️ 태그 제거됨: ${tag}',
      'toast.tagAdded': '🏷️ 태그 추가됨: ${tag}',
      'toast.linkCopied': '📋 링크 복사됨',
      'toast.copyFailed': '복사 실패',
      'toast.shareLinkCreated': '🔗 공개 링크 생성됨',
      'toast.ratingSet': '⭐ 별점 ${rating}점 설정됨',
      'toast.watchStarted': '📁 폴더 감시 시작: ${path}',
      'toast.watchStopped': '📁 폴더 감시 중지',
      'toast.languageChanged': '🌐 언어 변경됨',

      // errors (prefix-based)
      'error.peopleLoad': '인물 목록 로드 실패: ${error}',
      'error.personLoad': '인물 정보 로드 실패: ${error}',
      'error.renameFailed': '이름 변경 실패: ${error}',
      'error.genericFailed': '실패: ${error}',
      'error.partialFailed': '일부 실패: ${error}',
      'error.albumLoad': '앨범 로드 실패: ${error}',
      'error.albumListLoad': '앨범 목록 로드 실패: ${error}',
      'error.mapLoad': '지도 로드 실패: ${error}',
      'error.loadFailed': '로드 실패: ${error}',
      'error.searchFailed': '검색 실패: ${error}',
      'error.toastWrap': '오류: ${error}',
      'error.uploadFailed': '업로드 실패: ${error}',

      // album fallback
      'album.untitled': '제목 없음',
      'album.name': '앨범 이름',

      // common (additional)
      'common.input': '입력',
      'common.ok': '확인',
      'common.start': '시작',

      // business card (info modal)
      'bc.name': '이름',
      'bc.phone': '전화',
      'bc.email': '이메일',
      'bc.company': '회사',
      'bc.department': '부서',
      'bc.position': '직책',
      'bc.confidence': '신뢰도',

      // business card (sync/rescan toasts)
      'msg.bcSyncSuccess': '연락처 동기화 완료',
      'msg.bcSyncFailed': '연락처 동기화 실패',
      'msg.bcSyncError': '동기화 오류',
      'msg.bcRescanSuccess': '명함 재스캔 완료',
      'msg.bcRescanError': '재스캔 오류',

      // thumbnail kebab menu
      'menu.more': '더보기',
      'menu.removeFromFolder': '폴더에서 제외',
      'menu.delete': '삭제하기',
      'menu.sendToMail': '메일로 보내기',

      // bus
      'bus.connecting': 'bus 연결 중...',
      'bus.connected': 'bus 연결됨',
      'bus.disconnected': 'bus 끊김',
      'bus.failed': 'bus 실패',

      // fab
      'fab.openChat': '마이크루 대화창 열기',

      // settings (language picker)
      'settings.langKo': '한국어',
      'settings.langEn': 'English',
      'settings.langJa': '日本語',
    },

    en: {
      'nav.library': 'Library',
      'nav.map': 'Map',
      'nav.favorites': 'Favorites',
      'nav.archived': 'Archive',
      'nav.trash': 'Trash',
      'nav.albums': 'Albums',
      'nav.people': 'People',
      'nav.documents': 'Documents',
      'nav.screenshots': 'Screenshots',
      'nav.tags': 'Tags',
      'nav.businesscards': 'Business Cards',

      'common.add': 'Add',
      'common.delete': 'Delete',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.close': 'Close',
      'common.back': 'Back',
      'common.edit': 'Edit',
      'common.rename': 'Rename',
      'common.copy': 'Copy',
      'common.restore': 'Restore',
      'common.permanentDelete': 'Delete Forever',
      'common.upload': '⬆ Upload',
      'common.selectMode': '✓ Select',
      'common.selectModeOn': '✓ Select (on)',
      'common.or': 'or',
      'common.selectedCount': '${count} selected',
      'common.unspecified': 'Unspecified',
      'common.top': 'Top',

      'pageTitle.library': '📷 Library',
      'pageTitle.favorites': '⭐ Favorites',
      'pageTitle.archive': '📦 Archive',
      'pageTitle.trash': '🗑️ Trash',
      'pageTitle.map': '🗺️ Map',
      'pageTitle.albums': '📂 Albums',
      'pageTitle.people': '👤 People',
      'pageTitle.documents': '📄 Documents',
      'pageTitle.screenshots': '📱 Screenshots',
      'pageTitle.personDetail': '👤 ${name}',

      'btn.themeToggle': 'Toggle Theme',
      'btn.settings': '⚙️ Settings',
      'btn.importFolder': '📁 Import Folder',
      'btn.addToAlbum': '📂 Add to Album',
      'btn.toggleFavorite': '⭐ Favorite',
      'btn.toggleArchive': '📦 Archive',
      'btn.batchTrash': '🗑️ Trash',
      'btn.batchOcrDoc': '📝 Batch OCR',
      'btn.batchMail': '✉️ Send to Mail',
      'btn.cancel': 'Cancel',
      'btn.start': 'Start',
      'ocrDoc.title': '📝 Batch OCR to Document',
      'ocrDoc.desc': 'Extract text from <b>{count} photo(s)</b>, download as a document, and auto-add to the external library (MyCrew). May take tens of seconds to a few minutes.',
      'ocrDoc.labelTitle': 'Title (optional)',
      'ocrDoc.placeholderTitle': 'OCR document title',
      'ocrDoc.labelFormat': 'Format',
      'ocrDoc.optPdf': 'PDF (searchable, default)',
      'ocrDoc.optMd': 'Markdown (.md)',
      'ocrDoc.optTxt': 'Plain text (.txt)',
      'ocrDoc.optXlsx': 'Excel (.xlsx)',
      'btn.ok': 'OK',
      'albumPicker.title': 'Choose Album',
      'albumPicker.newLabel': '+ Create new album',
      'albumPicker.newPlaceholder': 'New album name',
      'zoom.label': 'Thumbnail size',
      'zoom.in': 'Zoom in',
      'zoom.out': 'Zoom out',
      'btn.lightboxClose': 'Close (ESC)',
      'btn.newAlbum': '+ New Album',
      'btn.createNewAlbum': 'Create New Album',
      'btn.addPhotosToAlbum': '+ Add Photos',
      'btn.backToAlbums': '← Back',
      'btn.backToPeople': '← People List',
      'btn.renamePerson': '✏️ Rename',
      'btn.detailView': 'View Detail',
      'btn.copy': '📋 Copy',
      'btn.shareCreate': 'Create Public Link',
      'btn.runReceiptOcr': '📝 Run Receipt OCR',
      'btn.runReceiptOcrRetry': '📝 Re-run Receipt OCR',
      'btn.runPlateOcr': '🚗 Run Plate OCR',
      'btn.runPlateOcrRetry': '🚗 Re-run Plate OCR',
      'btn.done': '✓ Done',
      'btn.processing': 'Processing...',

      'search.ocrPlaceholder': 'OCR text...',
      'search.tagPlaceholder': 'Tag...',
      'search.cameraPlaceholder': 'Camera...',
      'search.unifiedPlaceholder': 'Search: OCR / tag / camera...',
      'search.tagInputPlaceholder': 'Enter tag + Enter',

      'empty.noPhotosTitle': 'No photos yet',
      'empty.noPhotosHint': 'Get started with <b>Import Folder</b> or <b>Upload</b> at the top.',
      'empty.noDocumentsTitle': 'No documents detected yet',
      'empty.noDocumentsHint': 'New uploads are recognized automatically. To scan existing photos, click the button below.',
      'btn.runDocOcr': 'Analyze existing photos',
      'btn.removeFromCategory': 'Remove from this category',
      'msg.docOcrRunning': 'Analyzing… (up to 1–3 min)',
      'msg.docOcrDone': 'Done: scanned {scanned}, classified {classified} as documents',
      'msg.docOcrNoCandidate': 'No eligible photos to analyze',
      'empty.noAlbums': 'No albums',
      'empty.albumEmpty': 'This album is empty',
      'empty.noPeople': 'No people registered',
      'empty.peopleHint': 'People are auto-created when faces are detected in photos',
      'empty.noGps': 'No photos with GPS data',
      'empty.noTags': 'No tags',
      'empty.noShareLink': 'No public link',
      'empty.noWatchedFolders': 'No watched folders',
      'empty.noInfo': 'No info',
      'empty.ocrIdle': 'OCR not yet run',
      'empty.dateUnknown': 'Date unknown',

      'count.photos': '${count} photos',
      'count.yearsAgo': '${years} years ago',
      'count.yearMonth': '${year}-${month}',

      'section.shootingInfo': 'Shooting Info',
      'section.cameraSettings': 'Camera Settings',
      'section.location': 'Location',
      'section.ocrTitle': 'Text Recognition (OCR)',
      'section.rating': '⭐ Rating',
      'section.tags': '🏷️ Tags',
      'section.sharePublicLink': '🔗 Public Link',
      'section.memories': '💭 Memories',
      'section.settingsTitle': '⚙️ Settings',
      'section.watchedFolders': '📁 Auto-Watch Folders',
      'section.language': '🌐 Language',
      'section.theme': '🎨 Theme',
      'settings.themeLight': '☀️ Light',
      'settings.themeDark': '🌙 Dark',
      'btn.sidebarToggle': 'Toggle sidebar',

      'exif.date': 'Date Taken',
      'exif.location': 'Location',
      'exif.camera': 'Camera',
      'exif.lens': 'Lens',
      'exif.shutter': 'Shutter',
      'exif.aperture': 'Aperture',
      'exif.focalLength': 'Focal Length',
      'exif.coordinates': 'Coordinates',
      'exif.filename': 'Filename',
      'exif.size': 'Size',
      'exif.loadFailed': 'EXIF load failed',

      'ocr.receiptHeader': 'Receipt Text:',
      'ocr.plateLabel': 'Plate:',
      'ocr.empty': '(none)',
      'ocr.plateFailedPrefix': 'Plate: failed - ${error}',

      'share.passwordPlaceholder': 'Password (optional)',

      'watched.pathPlaceholder': 'Folder path (e.g. ~/Photos)',

      'prompt.newPersonName': 'Enter new name:',
      'prompt.albumRename': 'Rename album',
      'prompt.newAlbumName': 'Enter new album name',
      'prompt.albumChoice': 'Select album (enter number), or 0 to create new:\n${list}',
      'prompt.importFolderPath': 'Enter folder path to import\nExample: ~/Pictures',

      'confirm.deleteAlbum': 'Delete this album? (Photos will be preserved)',
      'confirm.permanentDelete': 'Permanently delete? This cannot be undone.',
      'confirm.trashMove': 'Move ${count} photos to trash?',

      'toast.renamed': '✓ Renamed: ${name}',
      'toast.albumRenamed': 'Album renamed',
      'toast.albumDeleted': 'Album deleted',
      'toast.albumCreated': 'Album created',
      'toast.photoRemoved': 'Photo removed',
      'toast.favoriteAdded': '⭐ Added to favorites',
      'toast.favoriteRemoved': 'Removed from favorites',
      'toast.archived': '📦 Moved to archive',
      'toast.archiveUndone': 'Archive undone',
      'toast.trashed': '🗑️ Moved to trash',
      'toast.removedFromCategory': '✕ Removed from category',
      'toast.restored': '✅ Restored',
      'toast.permanentDeleted': '🗑️ Permanently deleted',
      'toast.favoriteBatchDone': 'Favorites updated (${count} photos)',
      'toast.archiveBatchDone': 'Archive updated (${count} photos)',
      'toast.trashBatchDone': 'Moved to trash (${count} photos)',
      'toast.selectModeHint': 'Enable select mode, choose photos, then add to album',
      'toast.selectPhotos': 'Select photos first',
      'toast.invalidChoice': 'Invalid choice',
      'toast.addedToNewAlbum': 'Added ${count} photos to new album',
      'toast.addedToAlbum': 'Added ${count} photos to "${name}"',
      'toast.folderScanning': 'Scanning folder...',
      'toast.folderImportDone': 'Done: ${imported} imported, ${skipped} skipped',
      'toast.uploading': 'Uploading... (${count})',
      'toast.uploadDone': 'Upload done: ${count} added',
      'toast.tagRemoved': '🏷️ Tag removed: ${tag}',
      'toast.tagAdded': '🏷️ Tag added: ${tag}',
      'toast.linkCopied': '📋 Link copied',
      'toast.copyFailed': 'Copy failed',
      'toast.shareLinkCreated': '🔗 Public link created',
      'toast.ratingSet': '⭐ Rating set to ${rating}',
      'toast.watchStarted': '📁 Watching folder: ${path}',
      'toast.watchStopped': '📁 Stopped watching folder',
      'toast.languageChanged': '🌐 Language changed',

      'error.peopleLoad': 'Failed to load people: ${error}',
      'error.personLoad': 'Failed to load person: ${error}',
      'error.renameFailed': 'Rename failed: ${error}',
      'error.genericFailed': 'Failed: ${error}',
      'error.partialFailed': 'Partial failure: ${error}',
      'error.albumLoad': 'Album load failed: ${error}',
      'error.albumListLoad': 'Album list load failed: ${error}',
      'error.mapLoad': 'Map load failed: ${error}',
      'error.loadFailed': 'Load failed: ${error}',
      'error.searchFailed': 'Search failed: ${error}',
      'error.toastWrap': 'Error: ${error}',
      'error.uploadFailed': 'Upload failed: ${error}',

      'album.untitled': 'Untitled',
      'album.name': 'Album name',

      'common.input': 'Input',
      'common.ok': 'OK',
      'common.start': 'Start',

      'bc.name': 'Name',
      'bc.phone': 'Phone',
      'bc.email': 'Email',
      'bc.company': 'Company',
      'bc.department': 'Department',
      'bc.position': 'Position',
      'bc.confidence': 'Confidence',

      'msg.bcSyncSuccess': 'Contact synced',
      'msg.bcSyncFailed': 'Contact sync failed',
      'msg.bcSyncError': 'Sync error',
      'msg.bcRescanSuccess': 'Card rescanned',
      'msg.bcRescanError': 'Rescan error',

      'menu.more': 'More',
      'menu.removeFromFolder': 'Remove from folder',
      'menu.delete': 'Delete',
      'menu.sendToMail': 'Send to Mail',

      'bus.connecting': 'bus connecting...',
      'bus.connected': 'bus connected',
      'bus.disconnected': 'bus disconnected',
      'bus.failed': 'bus failed',

      'fab.openChat': 'Open MyCrew Chat',

      'settings.langKo': '한국어',
      'settings.langEn': 'English',
      'settings.langJa': '日本語',
    },

    ja: {
      'nav.library': 'ライブラリ',
      'nav.map': 'マップ',
      'nav.favorites': 'お気に入り',
      'nav.archived': 'アーカイブ',
      'nav.trash': 'ゴミ箱',
      'nav.albums': 'アルバム',
      'nav.people': '人物',
      'nav.documents': '書類',
      'nav.screenshots': 'スクリーンショット',
      'nav.tags': 'タグ',
      'nav.businesscards': '名刺',

      'common.add': '追加',
      'common.delete': '削除',
      'common.cancel': 'キャンセル',
      'common.confirm': '確認',
      'common.close': '閉じる',
      'common.back': '戻る',
      'common.edit': '編集',
      'common.rename': '名前変更',
      'common.copy': 'コピー',
      'common.restore': '復元',
      'common.permanentDelete': '完全削除',
      'common.upload': '⬆ アップロード',
      'common.selectMode': '✓ 選択',
      'common.selectModeOn': '✓ 選択 (オン)',
      'common.or': 'または',
      'common.selectedCount': '${count}件選択',
      'common.unspecified': '未指定',
      'common.top': 'トップ',

      'pageTitle.library': '📷 ライブラリ',
      'pageTitle.favorites': '⭐ お気に入り',
      'pageTitle.archive': '📦 アーカイブ',
      'pageTitle.trash': '🗑️ ゴミ箱',
      'pageTitle.map': '🗺️ マップ',
      'pageTitle.albums': '📂 アルバム',
      'pageTitle.people': '👤 人物',
      'pageTitle.documents': '📄 書類',
      'pageTitle.screenshots': '📱 スクリーンショット',
      'pageTitle.personDetail': '👤 ${name}',

      'btn.themeToggle': 'テーマ切替',
      'btn.settings': '⚙️ 設定',
      'btn.importFolder': '📁 フォルダ取込',
      'btn.addToAlbum': '📂 アルバムに追加',
      'btn.toggleFavorite': '⭐ お気に入り',
      'btn.toggleArchive': '📦 アーカイブ',
      'btn.batchTrash': '🗑️ ゴミ箱',
      'btn.batchOcrDoc': '📝 OCR文書化',
      'btn.batchMail': '✉️ メールで送る',
      'btn.cancel': 'キャンセル',
      'btn.start': '開始',
      'ocrDoc.title': '📝 OCR文書化',
      'ocrDoc.desc': '選択した<b>{count}枚</b>のテキストを抽出して文書としてダウンロードし、外部資料庫(MyCrew本体)に自動追加します。写真数に応じて数十秒〜数分かかります。',
      'ocrDoc.labelTitle': 'タイトル(任意)',
      'ocrDoc.placeholderTitle': 'OCR文書タイトル',
      'ocrDoc.labelFormat': 'フォーマット',
      'ocrDoc.optPdf': 'PDF(検索可、デフォルト)',
      'ocrDoc.optMd': 'Markdown (.md)',
      'ocrDoc.optTxt': 'テキスト (.txt)',
      'ocrDoc.optXlsx': 'Excel (.xlsx)',
      'btn.ok': '確認',
      'albumPicker.title': 'アルバム選択',
      'albumPicker.newLabel': '+ 新規アルバム作成',
      'albumPicker.newPlaceholder': '新規アルバム名',
      'zoom.label': 'サムネイルサイズ',
      'zoom.in': '拡大',
      'zoom.out': '縮小',
      'btn.lightboxClose': '閉じる (ESC)',
      'btn.newAlbum': '+ 新規アルバム',
      'btn.createNewAlbum': '新規アルバム作成',
      'btn.addPhotosToAlbum': '+ 写真追加',
      'btn.backToAlbums': '← 戻る',
      'btn.backToPeople': '← 人物一覧',
      'btn.renamePerson': '✏️ 名前変更',
      'btn.detailView': '詳細表示',
      'btn.copy': '📋 コピー',
      'btn.shareCreate': '公開リンク作成',
      'btn.runReceiptOcr': '📝 レシートOCR実行',
      'btn.runReceiptOcrRetry': '📝 レシートOCR再実行',
      'btn.runPlateOcr': '🚗 プレートOCR実行',
      'btn.runPlateOcrRetry': '🚗 プレートOCR再実行',
      'btn.done': '✓ 完了',
      'btn.processing': '処理中...',

      'search.ocrPlaceholder': 'OCRテキスト...',
      'search.tagPlaceholder': 'タグ...',
      'search.cameraPlaceholder': 'カメラ...',
      'search.unifiedPlaceholder': '検索: OCR / タグ / カメラ...',
      'search.tagInputPlaceholder': 'タグを入力してEnter',

      'empty.noPhotosTitle': '写真がまだありません',
      'empty.noPhotosHint': '上の <b>フォルダ取込</b> または <b>アップロード</b> で始めましょう。',
      'empty.noDocumentsTitle': 'ドキュメントとして認識された写真はありません',
      'empty.noDocumentsHint': '新規アップロードは自動で認識されます。既存写真を一括分析するには下のボタンを押してください。',
      'btn.runDocOcr': '既存写真を一括分析',
      'btn.removeFromCategory': 'カテゴリから削除',
      'msg.docOcrRunning': '分析中…（最大 1〜3 分）',
      'msg.docOcrDone': '完了: {scanned} 枚分析、{classified} 枚をドキュメントに分類',
      'msg.docOcrNoCandidate': '分析対象の写真がありません',
      'empty.noAlbums': 'アルバムなし',
      'empty.albumEmpty': 'このアルバムは空です',
      'empty.noPeople': '登録された人物なし',
      'empty.peopleHint': '写真から顔が検出されると自動で人物が作成されます',
      'empty.noGps': 'GPS情報付き写真なし',
      'empty.noTags': 'タグなし',
      'empty.noShareLink': '公開リンクなし',
      'empty.noWatchedFolders': '監視中のフォルダなし',
      'empty.noInfo': '情報なし',
      'empty.ocrIdle': 'OCR未実行',
      'empty.dateUnknown': '日付不明',

      'count.photos': '${count}枚',
      'count.yearsAgo': '${years}年前',
      'count.yearMonth': '${year}年${month}月',

      'section.shootingInfo': '撮影情報',
      'section.cameraSettings': 'カメラ設定',
      'section.location': '場所',
      'section.ocrTitle': 'テキスト認識 (OCR)',
      'section.rating': '⭐ 評価',
      'section.tags': '🏷️ タグ',
      'section.sharePublicLink': '🔗 公開リンク',
      'section.memories': '💭 思い出',
      'section.settingsTitle': '⚙️ 設定',
      'section.watchedFolders': '📁 フォルダ自動監視',
      'section.language': '🌐 言語',
      'section.theme': '🎨 テーマ',
      'settings.themeLight': '☀️ ライト',
      'settings.themeDark': '🌙 ダーク',
      'btn.sidebarToggle': 'サイドバー切替',

      'exif.date': '撮影日',
      'exif.location': '場所',
      'exif.camera': 'カメラ',
      'exif.lens': 'レンズ',
      'exif.shutter': 'シャッター',
      'exif.aperture': '絞り',
      'exif.focalLength': '焦点距離',
      'exif.coordinates': '座標',
      'exif.filename': 'ファイル名',
      'exif.size': 'サイズ',
      'exif.loadFailed': 'EXIF読込失敗',

      'ocr.receiptHeader': 'レシートテキスト:',
      'ocr.plateLabel': 'プレート:',
      'ocr.empty': '(なし)',
      'ocr.plateFailedPrefix': 'プレート: 失敗 - ${error}',

      'share.passwordPlaceholder': 'パスワード（任意）',

      'watched.pathPlaceholder': 'フォルダパス（例: ~/Photos）',

      'prompt.newPersonName': '新しい名前を入力してください:',
      'prompt.albumRename': 'アルバム名変更',
      'prompt.newAlbumName': '新しいアルバム名を入力してください',
      'prompt.albumChoice': 'アルバムを選択してください（番号入力）。0で新規作成:\n${list}',
      'prompt.importFolderPath': '取り込むフォルダパスを入力してください\n例: ~/Pictures',

      'confirm.deleteAlbum': 'このアルバムを削除しますか？（写真は保持されます）',
      'confirm.permanentDelete': '本当に完全削除しますか？この操作は元に戻せません。',
      'confirm.trashMove': '${count}枚をゴミ箱へ移動しますか？',

      'toast.renamed': '✓ 名前変更: ${name}',
      'toast.albumRenamed': 'アルバム名を変更しました',
      'toast.albumDeleted': 'アルバムを削除しました',
      'toast.albumCreated': 'アルバムを作成しました',
      'toast.photoRemoved': '写真を削除しました',
      'toast.favoriteAdded': '⭐ お気に入りに追加',
      'toast.favoriteRemoved': 'お気に入りから削除',
      'toast.archived': '📦 アーカイブへ移動',
      'toast.archiveUndone': 'アーカイブ解除',
      'toast.trashed': '🗑️ ゴミ箱へ移動',
      'toast.removedFromCategory': '✕ カテゴリから削除しました',
      'toast.restored': '✅ 復元しました',
      'toast.permanentDeleted': '🗑️ 完全削除しました',
      'toast.favoriteBatchDone': 'お気に入りを更新 (${count}枚)',
      'toast.archiveBatchDone': 'アーカイブを更新 (${count}枚)',
      'toast.trashBatchDone': 'ゴミ箱へ移動 (${count}枚)',
      'toast.selectModeHint': '選択モードに切替えて写真を選び、アルバムに追加してください',
      'toast.selectPhotos': '写真を選択してください',
      'toast.invalidChoice': '無効な選択です',
      'toast.addedToNewAlbum': '${count}枚を新規アルバムに追加',
      'toast.addedToAlbum': '${count}枚を「${name}」に追加',
      'toast.folderScanning': 'フォルダをスキャン中...',
      'toast.folderImportDone': '完了: ${imported}枚取込、${skipped}枚スキップ',
      'toast.uploading': 'アップロード中... (${count}枚)',
      'toast.uploadDone': 'アップロード完了: ${count}枚追加',
      'toast.tagRemoved': '🏷️ タグ削除: ${tag}',
      'toast.tagAdded': '🏷️ タグ追加: ${tag}',
      'toast.linkCopied': '📋 リンクをコピー',
      'toast.copyFailed': 'コピー失敗',
      'toast.shareLinkCreated': '🔗 公開リンクを作成',
      'toast.ratingSet': '⭐ 評価を${rating}点に設定',
      'toast.watchStarted': '📁 フォルダ監視開始: ${path}',
      'toast.watchStopped': '📁 フォルダ監視停止',
      'toast.languageChanged': '🌐 言語を変更しました',

      'error.peopleLoad': '人物一覧の読込失敗: ${error}',
      'error.personLoad': '人物情報の読込失敗: ${error}',
      'error.renameFailed': '名前変更失敗: ${error}',
      'error.genericFailed': '失敗: ${error}',
      'error.partialFailed': '一部失敗: ${error}',
      'error.albumLoad': 'アルバム読込失敗: ${error}',
      'error.albumListLoad': 'アルバム一覧読込失敗: ${error}',
      'error.mapLoad': 'マップ読込失敗: ${error}',
      'error.loadFailed': '読込失敗: ${error}',
      'error.searchFailed': '検索失敗: ${error}',
      'error.toastWrap': 'エラー: ${error}',
      'error.uploadFailed': 'アップロード失敗: ${error}',

      'album.untitled': '無題',
      'album.name': 'アルバム名',

      'common.input': '入力',
      'common.ok': '確認',
      'common.start': '開始',

      'bc.name': '名前',
      'bc.phone': '電話',
      'bc.email': 'メール',
      'bc.company': '会社',
      'bc.department': '部署',
      'bc.position': '役職',
      'bc.confidence': '信頼度',

      'msg.bcSyncSuccess': '連絡先を同期しました',
      'msg.bcSyncFailed': '連絡先の同期に失敗しました',
      'msg.bcSyncError': '同期エラー',
      'msg.bcRescanSuccess': '名刺を再スキャンしました',
      'msg.bcRescanError': '再スキャンエラー',

      'menu.more': 'もっと見る',
      'menu.removeFromFolder': 'フォルダから除外',
      'menu.delete': '削除',
      'menu.sendToMail': 'メールで送る',

      'bus.connecting': 'bus 接続中...',
      'bus.connected': 'bus 接続済み',
      'bus.disconnected': 'bus 切断',
      'bus.failed': 'bus 失敗',

      'fab.openChat': 'MyCrew チャットを開く',

      'settings.langKo': '한국어',
      'settings.langEn': 'English',
      'settings.langJa': '日本語',
    },
  };

  function getLocale() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (LOCALES.indexOf(saved) >= 0) return saved;
    } catch (_) {}
    return 'ko';
  }

  function t(key, vars) {
    var loc = getLocale();
    var text = (dict[loc] && dict[loc][key]) || (dict.ko && dict.ko[key]) || key;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          text = text.split('${' + k + '}').join(String(vars[k]));
        }
      }
    }
    return text;
  }

  function setLang(lang) {
    if (LOCALES.indexOf(lang) < 0) return;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}
    applyI18nDOM(document.body);
    window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: lang } }));
  }

  // applyI18nDOM — sweep root and apply data-i18n*, data-i18n-attr-*, data-i18n-html
  function applyI18nDOM(root) {
    root = root || document.body;
    if (!root || !root.querySelectorAll) return;

    // textContent
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    // innerHTML (for messages that intentionally contain markup like <b>)
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (!key) return;
      el.innerHTML = t(key);
    });
    // attribute: placeholder
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      el.setAttribute('placeholder', t(key));
    });
    // attribute: title
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-title');
      if (!key) return;
      el.setAttribute('title', t(key));
    });
    // attribute: aria-label
    root.querySelectorAll('[data-i18n-aria-label]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-aria-label');
      if (!key) return;
      el.setAttribute('aria-label', t(key));
    });

    // active-lang highlight on language buttons (mycrew-photos settings)
    var curr = getLocale();
    root.querySelectorAll('[data-lang]').forEach(function (btn) {
      if (btn.getAttribute('data-lang') === curr) {
        btn.classList.add('primary');
      } else {
        btn.classList.remove('primary');
      }
    });
  }

  function onLocaleChange(cb) {
    var handler = function (e) {
      if (e.key === STORAGE_KEY) cb();
    };
    window.addEventListener('storage', handler);
    var customHandler = function () { cb(); };
    window.addEventListener('i18n:changed', customHandler);
    return function () {
      window.removeEventListener('storage', handler);
      window.removeEventListener('i18n:changed', customHandler);
    };
  }

  // Public API
  window.i18n = {
    LOCALES: LOCALES,
    getLocale: getLocale,
    setLang: setLang,
    t: t,
    applyI18nDOM: applyI18nDOM,
    onLocaleChange: onLocaleChange,
    dictionary: dict,
  };
  window.t = t; // shortcut

  // Auto-apply on DOM ready (handles late <script> load too)
  function autoInit() {
    applyI18nDOM(document.body);
    // re-apply on language change (storage event from other tabs or mycrew-system)
    window.addEventListener('storage', function (e) {
      if (e.key === STORAGE_KEY) {
        applyI18nDOM(document.body);
        window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { lang: getLocale() } }));
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
