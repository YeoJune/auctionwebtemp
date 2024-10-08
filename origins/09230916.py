import sys
import os
import requests
from requests.exceptions import RequestException
from bs4 import BeautifulSoup
import time
import urllib.parse
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QListWidget, QLabel, QMessageBox, QProgressBar, QTableWidget, QTableWidgetItem, QTabWidget, QFileDialog, QHeaderView)
from PyQt5.QtGui import QPixmap
from PyQt5.QtCore import Qt, QThread, pyqtSignal, QSize
from openpyxl import Workbook
from openpyxl.drawing.image import Image
from openpyxl.utils import get_column_letter
from googletrans import Translator
from gspread.exceptions import APIError
from concurrent.futures import ThreadPoolExecutor
import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import threading
import re
import datetime

# 브랜드 리스트 정의
BRANDS = [
    "LOUIS VUITTON", "CHANEL", "HERMES", "GUCCI", "PRADA", "ROLEX", "OMEGA", "TAG Heuer", "Cartier", "BVLGARI", "Tiffany＆Co.", "HARRY WINSTON", "Van Cleef＆Arpels", "A. LANGE & SOHNE", "AUDEMARS PIGUET", "Baccarat", "BALENCIAGA", "BALLY", "BAUME＆MERCIER", "Bell & Ross", "Berluti", "BOTTEGA VENETA", "BOUCHERON", "BREGUET", "BREITLING", "BUCCELLATI", "BURBERRY", "Carlo Parlati", "Carrera y Carrera", "CASIO", "CAZZANIGA", "CELINE", "CHARRIOL", "CHAUMET", "chloe", "Chopard", "Christian Louboutin", "CHROME HEARTS", "CITIZEN", "COACH", "Cole Haan", "COMME des GARCONS", "CORUM", "D＆G", "Damiani", "DE BEERS", "Dior", "DOLCE＆GABBANA", "DSQUARED2", "dunhill", "EDOX", "EMILIO PUCCI", "ETRO", "FEDERICO BUCCELLATI", "Felisi", "FENDI", "FRANCK MULLER", "FRED", "FREDERIQUE CONSTANT", "FURLA", "GaGa MILANO", "Georg Jensen", "gimel", "GIRARD PERREGAUX", "GIVENCHY", "GOYARD", "GRAFF", "GRAHAM", "HUBLOT", "IWC", "Jacob&co", "JAEGER LECOULTRE", "Jeunet", "JEWEL STUDIO", "JILSANDER", "JIMMY CHOO", "Justin Davis", "Kashikey", "Kate Spade", "LANVIN", "LOEWE", "LONG CHAMP", "LONGINES", "MACKINTOSH", "MARC BY MARC JACOBS", "MARC JACOBS", "MAUBOUSSIN", "MAURICE LACROIX", "MCM", "Meissen", "Michael Kors", "MIKIMOTO", "miu miu", "MONCLER", "MONTBLANC", "ORIENT", "Orobianco", "PANERAI", "PATEK PHILIPPE", "PIAGET", "POLA", "POMELLATO", "Ponte Vecchio", "RADO", "RayBan", "REGAL", "RICHARD MILLE", "RIMOWA", "Ritmo latino", "ROGER DUBUIS", "SAINT LAURENT", "Salvatore Ferragamo", "SEE BY CHLOE", "SEIKO", "Sergio Rossi", "SINN", "SOUTHERN CROSS", "Supreme", "TASAKI", "TOD'S", "Tom Ford", "Tory Burch", "TUDOR", "TUMI", "ULYSSE NARDIN", "UNIVERSAL GENEVE", "UNOAERRE", "VACHERON CONSTANTIN", "VALENTINO", "Vendome Aoyama", "Verite", "VERSACE", "WALTHAM", "Yves Saint Laurent", "ZENITH", "梶 光夫", "梶武史", "石川 暢子", "田村 俊一"
]

# 텔레그램 봇 설정
BOT_TOKEN = '7867498915:AAGaPNSo1-0ar89M1HOxMOP_z2rpGvRC_j4'
bot = telebot.TeleBot(BOT_TOKEN)

# 구글 스프레드시트 설정
SPREADSHEET_CREDENTIALS = '/Users/hwangseungha/Desktop/개발/1/soy-pillar-436505-e6-a84c54f9816a.json'

def login_and_check():
    session = requests.Session()
    login_url = "https://www.ecoauc.com/client/users/post-sign-in"
    login_data = {
        "_method": "POST",
        "_csrfToken": "",
        "email_address": "casaboutique@naver.com",
        "password": "Wm8AXpVY2666",
        "remember-me": "remember-me"
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    }

    print("로그인 페이지 접근 중...")
    login_page = session.get("https://www.ecoauc.com/client/users/sign-in", headers=headers)
    print(f"로그인 페이지 상태 코드: {login_page.status_code}")

    soup = BeautifulSoup(login_page.text, 'html.parser')
    csrf_token = soup.find('input', {'name': '_csrfToken'})['value']
    login_data['_csrfToken'] = csrf_token
    print(f"CSRF 토큰 찾음: {csrf_token}")

    print("로그인 시도 중...")
    login_response = session.post(login_url, data=login_data, headers=headers, allow_redirects=False)
    print(f"Login status code: {login_response.status_code}")

    if login_response.status_code == 302:
        redirect_url = login_response.headers['Location']
        print(f"리다이렉트 URL: {redirect_url}")
        home_page = session.get(redirect_url, headers=headers)
        print(f"홈페이지 상태 코드: {home_page.status_code}")

        print("アカウント 페이지 접근 중...")
        account_url = "https://www.ecoauc.com/client/users"
        account_page = session.get(account_url, headers=headers)
        print(f"アカウント 페이지 상태 코드: {account_page.status_code}")

        soup = BeautifulSoup(account_page.text, 'html.parser')
        if "アカウント" in account_page.text and soup.find('a', string='ログアウト'):
            print("로그인 성공!")
            return session
        else:
            print("로그인 실패 또는 アカウント 페이지를 찾을 수 없습니다.")
            return None
    else:
        print("로그인 실패.")
        return None

def get_total_pages(session, base_url, params):
    response = session.get(base_url, params=params)
    soup = BeautifulSoup(response.text, 'html.parser')

    pagination = soup.find("ul", class_="pagination")
    if pagination:
        page_links = pagination.find_all("li")
        for link in reversed(page_links):
            a_tag = link.find("a")
            if a_tag and a_tag.text.strip().isdigit():
                return int(a_tag.text.strip())

    items = soup.find_all("div", class_="card")
    if items:
        return 1

    return 0

def create_output_folder(brand):
    output_folder = os.path.join(os.path.expanduser("~"), "Desktop", "크롤링결과", brand)
    os.makedirs(output_folder, exist_ok=True)
    return output_folder

def download_image(image_url, save_dir):
    try:
        parsed_url = urllib.parse.urlparse(image_url)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        query_params.pop('w', None)
        query_params.pop('h', None)
        new_query = urllib.parse.urlencode(query_params, doseq=True)
        new_url = urllib.parse.urlunparse(parsed_url._replace(query=new_query))

        response = requests.get(new_url, timeout=30)
        if response.status_code == 200:
            os.makedirs(save_dir, exist_ok=True)
            file_name = os.path.join(save_dir, os.path.basename(new_url))
            with open(file_name, 'wb') as f:
                f.write(response.content)
            return file_name
    except Exception as e:
        print(f"Error downloading image {image_url}: {e}")
    return None

def translate_text(translator, text):
    try:
        translated = translator.translate(text, src='ja', dest='ko')
        return translated.text
    except Exception as e:
        print(f"Translation error: {e}")
    return text

def search_and_crawl(session, brands, categories, output_folder, translator, progress_callback=None):
    base_url = "https://www.ecoauc.com/client/auctions/inspect"
    all_items = []
    total_brands = len(brands)

    for brand_index, brand in enumerate(brands):
        params = {
            "limit": "500",
            "sortKey": "1",
            "tableType": "grid",
            "q": brand,
            "low": "",
            "high": "",
            "master_item_brands": "",
            "auction_lane_id": "",
            "master_item_shapes": "",
            "master_item_ranks": "",
            "page": "1"
        }

        for i, category in enumerate(categories):
            params[f"master_item_categories[{i}]"] = category

        total_pages = get_total_pages(session, base_url, params)
        print(f"Total pages for {brand}: {total_pages}")

        image_urls = []
        for page in range(1, total_pages + 1):
            print(f"Crawling page {page} for {brand}...")
            params["page"] = str(page)
            response = session.get(base_url, params=params)
            soup = BeautifulSoup(response.text, 'html.parser')

            items = soup.find_all("div", class_="col-sm-6 col-md-4 col-lg-3 mb-grid-card")

            if not items:
                print(f"No items found on page {page} for {brand}. Stopping crawl.")
                break

            print(f"Found {len(items)} items on page {page}")

            for idx, item in enumerate(items, 1):
                try:
                    brand_elem = item.find("small", class_="show-case-bland")
                    brand_text = brand_elem.text.strip() if brand_elem else "N/A"
                    if brand_text != brand:
                        continue

                    title_elem = item.find("b")
                    title = title_elem.text.strip() if title_elem else "N/A"
                    title = translate_text(translator, title) if translator else title

                    canopy = item.find("ul", class_="canopy canopy-3 text-default")
                    if canopy:
                        rank_elem = canopy.find_all("li")[0].find("big", class_="canopy-value")
                        rank = rank_elem.next_sibling.strip() if rank_elem else "N/A"

                        price_elem = canopy.find_all("li")[1].find("big", class_="canopy-value")
                        starting_price = price_elem.text.strip() if price_elem else "N/A"
                    else:
                        rank = "N/A"
                        starting_price = "N/A"

                    image_elem = item.find("div", class_="item-image item-image-min pc-image-area")
                    if image_elem and image_elem.find("img"):
                        image_url = image_elem.find("img")['src']
                        image_urls.append(image_url)

                    market_title_elem = item.find("span", class_="market-title")
                    if market_title_elem:
                        market_title_text = market_title_elem.text.strip()
                        market_time = market_title_text
                        market_time = translate_text(translator, market_time) if translator else market_time
                    else:
                        market_time = "N/A"

                    all_items.append({
                        "Brand": brand,
                        "Title": title,
                        "Rank": rank,
                        "Starting Price": starting_price,
                        "Image": None,
                        "Time": market_time
                    })

                    if progress_callback:
                        progress_callback(brand, page, total_pages, len(all_items), idx)

                    if idx % 10 == 0:
                        print(f"Processed {idx}/{len(items)} items on page {page}")
                except Exception as e:
                    print(f"Error processing item {idx} on page {page}: {e}")
                    print(f"Item HTML: {item}")

            print(f"Page {page} crawled successfully.")
            time.sleep(1)

    print(f"Crawling completed. Total items found: {len(all_items)}")

    # 이미지 다운로드
    with ThreadPoolExecutor() as executor:
        futures = []
        for image_url in image_urls:
            futures.append(executor.submit(download_image, image_url, os.path.join(output_folder, 'images')))

        for future in futures:
            image_path = future.result()
            if image_path:
                for item in all_items:
                    if item["Image"] is None:
                        item["Image"] = os.path.basename(image_path)
                        break

    return all_items

class CrawlerThread(QThread):
    update_progress = pyqtSignal(str, int, int, int, int)
    finished = pyqtSignal(list)

    def __init__(self, session, brands, categories, output_folder, translator):
        QThread.__init__(self)
        self.session = session
        self.brands = brands
        self.categories = categories
        self.output_folder = output_folder
        self.translator = translator

    def run(self):
        items = search_and_crawl(self.session, self.brands, self.categories, self.output_folder, self.translator, self.progress_callback)
        self.finished.emit(items)

    def progress_callback(self, brand, current_page, total_pages, items_found, images_downloaded):
        self.update_progress.emit(brand, current_page, total_pages, items_found, images_downloaded)

def save_to_spreadsheet(items):
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds = ServiceAccountCredentials.from_json_keyfile_name(SPREADSHEET_CREDENTIALS, scope)
    client = gspread.authorize(creds)

    spreadsheet = client.create(f"크롤링 결과 {time.strftime('%Y-%m-%d %H:%M:%S')}")
    sheet = spreadsheet.get_worksheet(0)

    headers = ["선택", "Brand", "Title", "Rank", "Starting Price", "Image", "Time"]
    sheet.append_row(headers)

    for item in items:
        row = [False, item["Brand"], item["Title"], item["Rank"], item["Starting Price"], item["Image"], item["Time"]]
        sheet.append_row(row)

    # 체크박스 열 추가
    if len(items) > 0:
        checkbox_range = f'A2:A{len(items)+1}'
        checkbox_request = {
            'repeatCell': {
                'range': {
                    'sheetId': sheet.id,
                    'startRowIndex': 1,
                    'endRowIndex': len(items) + 1,
                    'startColumnIndex': 0,
                    'endColumnIndex': 1
                },
                'cell': {
                    'dataValidation': {
                        'condition': {
                            'type': 'BOOLEAN'
                        }
                    }
                },
                'fields': 'dataValidation'
            }
        }
        spreadsheet.batch_update({'requests': [checkbox_request]})

    # 권한 설정 (누구나 편집 가능하게)
    spreadsheet.share('', perm_type='anyone', role='writer')

    return spreadsheet.url

def monitor_spreadsheet(spreadsheet_url):
    global PERSONAL_SPREADSHEET_ID
    PERSONAL_SPREADSHEET_ID = '1hKT6EFt5OvUiHUx70C15udp7OIeikLiy3egWJ9UDSeQ'
    
    print(f"모니터링 시작: {spreadsheet_url}")
    
    try:
        scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        creds = ServiceAccountCredentials.from_json_keyfile_name(SPREADSHEET_CREDENTIALS, scope)
        client = gspread.authorize(creds)
        print("Google Sheets API 인증 성공")

        source_spreadsheet = client.open_by_url(spreadsheet_url)
        source_sheet = source_spreadsheet.get_worksheet(0)
        print(f"원본 스프레드시트 열기 성공: {source_spreadsheet.title}")

        personal_spreadsheet = client.open_by_key(PERSONAL_SPREADSHEET_ID)
        print(f"개인 스프레드시트 열기 성공: {personal_spreadsheet.title}")
        
        today = datetime.date.today()
        sheet_name = today.strftime("%Y-%m-%d")
        
        try:
            personal_sheet = personal_spreadsheet.worksheet(sheet_name)
            print(f"'{sheet_name}' 시트를 찾았습니다.")
        except gspread.exceptions.WorksheetNotFound:
            print(f"'{sheet_name}' 시트를 찾을 수 없습니다. 새로 생성합니다.")
            personal_sheet = personal_spreadsheet.add_worksheet(title=sheet_name, rows="100", cols="20")
            print(f"'{sheet_name}' 시트가 생성되었습니다.")
            
            headers = ["Brand", "Title", "Rank", "Starting Price", "Image", "Time"]
            personal_sheet.append_row(headers)
            print("헤더 추가 완료")

        last_checked_row = 1  # 헤더를 포함하여 시작

        while True:
            try:
                # 체크박스 열의 값을 별도로 가져옵니다.
                checkbox_values = source_sheet.get_values('A2:A')
                # 나머지 데이터를 가져옵니다.
                values = source_sheet.get_values('B2:G')

                print(f"원본 시트에서 {len(values)} 행의 데이터를 가져왔습니다.")
                
                for i, (checkbox, row) in enumerate(zip(checkbox_values, values), start=2):
                    checkbox_value = checkbox[0] if checkbox else "No data"
                    print(f"행 {i} 체크박스 값: {checkbox_value}")
                    print(f"행 {i} 데이터: {row}")
                    
                    if checkbox_value == 'TRUE':
                        print(f"선택된 행 발견: {row[:3]}...")  # Brand, Title, Rank만 출력
                        existing_rows = personal_sheet.get_all_values()
                        if row not in existing_rows:
                            personal_sheet.append_row(row)
                            print(f"새 항목 추가됨: {row[0]}, {row[1]}")
                        else:
                            print(f"중복 항목 발견, 건너뜁니다: {row[0]}, {row[1]}")
                    else:
                        print(f"선택되지 않은 행: {row[:3]}...")  # Brand, Title, Rank만 출력
                
                last_checked_row = len(values) + 1
                print(f"마지막으로 확인한 행: {last_checked_row}")
            except gspread.exceptions.APIError as e:
                print(f"API 에러 발생: {e}")
                time.sleep(60)
            except Exception as e:
                print(f"예외 발생: {e}")
                print(f"예외 타입: {type(e)}")
                print(f"예외 인자: {e.args}")
            
            print("30초 대기 중...")
            time.sleep(30)
    except Exception as e:
        print(f"monitor_spreadsheet에서 오류 발생: {e}")
        print(f"오류 타입: {type(e)}")
        print(f"오류 인자: {e.args}")

def parse_user_input(input_text):
    # 브랜드와 카테고리 매핑 정의
    brand_mapping = {
        "샤넬": "CHANEL", "루이비통": "LOUIS VUITTON", "에르메스": "HERMES", "구찌": "GUCCI", "프라다": "PRADA", "롤렉스": "ROLEX", "오메가": "OMEGA", "태그호이어": "TAG Heuer", "까르띠에": "Cartier", "불가리": "BVLGARI", "티파니": "TIFFANY & Co.", "몽블랑": "MONTBLANC", "버버리": "BURBERRY", "발렌시아가": "BALENCIAGA", "보테가베네타": "BOTTEGA VENETA", "셀린느": "CELINE", "크리스찬디올": "Christian Dior", "돌체앤가바나": "DOLCE & GABBANA", "펜디": "FENDI", "지방시": "GIVENCHY", "고야드": "GOYARD", "이브생로랑": "SAINT LAURENT", "발렌티노": "VALENTINO", "베르사체": "VERSACE", "톰브라운": "THOM BROWNE", "멀버리": "Mulberry", "로에베": "LOEWE", "지미추": "Jimmy Choo", "발리": "Bally", "토즈": "TOD'S", "미우미우": "MIU MIU", "몽클레어": "MONCLER", "아페쎄": "A.P.C", "아크네스튜디오": "Acne Studios", "알렉산더맥퀸": "Alexander McQueen", "발망": "BALMAIN", "겐조": "KENZO", "메종마르지엘라": "Maison Margiela", "막스마라": "Max Mara", "스텔라매카트니": "Stella McCartney", "아미": "AMI", "아크로님": "ACRONYM", "아미리": "AMIRI", "아페쎄": "A.P.C.", "아워레가시": "Our Legacy", "어더에러": "Ader Error", "알릭스": "1017 ALYX 9SM", "언더커버": "UNDERCOVER", "오프화이트": "Off-White", "이자벨마랑": "Isabel Marant", "제이더블유앤더슨": "JW ANDERSON", "질샌더": "Jil Sander", "폴스미스": "Paul Smith", "휴고보스": "HUGO BOSS"
    }

    category_mapping = {
        "가방": "2",
        "시계": "1",
        "귀금속": "3",
        "악세서리": "4",
        "소품": "5",
        "의류": "8",
        "신발": "9",
        "기타": "27"
    }

    # 입력 텍스트에서 브랜드와 카테고리 추출
    words = input_text.split()
    brand = None
    category = None

    for word in words:
        if word.upper() in [b.upper() for b in brand_mapping.keys()]:
            brand = brand_mapping[word]
        if word in category_mapping.keys():
            category = category_mapping[word]

    return brand, category

@bot.message_handler(commands=['start'])
def send_welcome(message):
    bot.reply_to(message, "안녕하세요! 저는 까사트레이드의 봇 입니다 원하시는 제품을 채팅창에 입력 하시면 현재 올라온 경매출품 목록들을 보실수 있습니다. (예: 샤넬 가방)")

@bot.message_handler(func=lambda message: True)
def handle_message(message):
    brand, category = parse_user_input(message.text)

    if not brand or not category:
        bot.reply_to(message, "죄송합니다. 브랜드와 카테고리를 정확히 입력해주세요. (예: 샤넬 가방)")
        return

    session = login_and_check()
    if not session:
        bot.reply_to(message, "죄송합니다. 로그인에 실패했습니다. 나중에 다시 시도해주세요.")
        return

    output_folder = create_output_folder(brand)
    translator = Translator()

    # 여기서 크롤링 함수를 호출하고 결과를 스프레드시트에 저장
    items = search_and_crawl(session, [brand], [category], output_folder, translator)
    spreadsheet_url = save_to_spreadsheet(items)
    bot.reply_to(message, f"크롤링이 완료되었습니다. 결과를 확인해주세요: {spreadsheet_url}")

    # 모니터링 시작
    threading.Thread(target=monitor_spreadsheet, args=(spreadsheet_url,), daemon=True).start()

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("브랜드 크롤러")
        self.setGeometry(100, 100, 1200, 800)

        main_widget = QWidget()
        self.setCentralWidget(main_widget)

        layout = QVBoxLayout()
        main_widget.setLayout(layout)

        # 브랜드 선택
        brand_layout = QHBoxLayout()
        self.brand_list = QListWidget()
        self.brand_list.addItems(BRANDS)
        self.brand_list.setSelectionMode(QListWidget.MultiSelection)
        brand_layout.addWidget(self.brand_list)

        # 카테고리 선택
        category_layout = QVBoxLayout()
        category_label = QLabel("카테고리 선택:")
        category_layout.addWidget(category_label)
        self.category_buttons = []
        categories = ["시계", "가방", "귀금속", "악세서리", "소품", "의류", "신발", "기타"]
        category_ids = ["1", "2", "3", "4", "5", "8", "9", "27"]
        for category, category_id in zip(categories, category_ids):
            button = QPushButton(category)
            button.setCheckable(True)
            category_layout.addWidget(button)
            self.category_buttons.append((button, category_id))

        brand_layout.addLayout(category_layout)
        layout.addLayout(brand_layout)

        # 저장 위치 선택
        save_layout = QHBoxLayout()
        self.save_location_label = QLabel("저장 위치: 선택되지 않음")
        save_layout.addWidget(self.save_location_label)
        save_button = QPushButton("저장 위치 선택")
        save_button.clicked.connect(self.select_save_location)
        save_layout.addWidget(save_button)
        layout.addLayout(save_layout)

        # 실행 버튼
        self.run_button = QPushButton("크롤링 시작")
        self.run_button.clicked.connect(self.start_crawling)
        layout.addWidget(self.run_button)

        # 진행 상황 표시
        self.progress_bar = QProgressBar()
        layout.addWidget(self.progress_bar)
        self.progress_label = QLabel("대기 중...")
        layout.addWidget(self.progress_label)

        # 결과 표시 탭
        self.result_tabs = QTabWidget()
        layout.addWidget(self.result_tabs)

        self.output_folder = None
        self.translator = Translator()

    def select_save_location(self):
        folder = QFileDialog.getExistingDirectory(self, "저장 위치 선택")
        if folder:
            self.output_folder = folder
            self.save_location_label.setText(f"저장 위치: {folder}")

    def start_crawling(self):
        if not self.output_folder:
            QMessageBox.warning(self, "경고", "저장 위치를 선택해주세요.")
            return

        selected_brands = [item.text() for item in self.brand_list.selectedItems()]
        if not selected_brands:
            QMessageBox.warning(self, "경고", "브랜드를 선택해주세요.")
            return

        selected_categories = [category_id for button, category_id in self.category_buttons if button.isChecked()]
        if not selected_categories:
            QMessageBox.warning(self, "경고", "카테고리를 선택해주세요.")
            return

        session = login_and_check()
        if not session:
            QMessageBox.critical(self, "오류", "로그인에 실패했습니다.")
            return

        self.crawler_thread = CrawlerThread(session, selected_brands, selected_categories, self.output_folder, self.translator)
        self.crawler_thread.update_progress.connect(self.update_progress)
        self.crawler_thread.finished.connect(self.crawling_finished)
        self.crawler_thread.start()

        self.run_button.setEnabled(False)

    def update_progress(self, brand, current_page, total_pages, items_found, images_downloaded):
        self.progress_label.setText(f"브랜드: {brand}, 페이지: {current_page}/{total_pages}, 아이템: {items_found}, 이미지: {images_downloaded}")
        self.progress_bar.setValue(int(current_page / total_pages * 100))

    def crawling_finished(self, items):
        self.run_button.setEnabled(True)
        self.progress_bar.setValue(100)
        self.progress_label.setText("크롤링 완료")

        # 결과를 표로 표시
        result_table = QTableWidget()
        result_table.setColumnCount(6)
        result_table.setHorizontalHeaderLabels(["Brand", "Title", "Rank", "Starting Price", "Image", "Time"])
        result_table.setRowCount(len(items))

        for row, item in enumerate(items):
            result_table.setItem(row, 0, QTableWidgetItem(item["Brand"]))
            result_table.setItem(row, 1, QTableWidgetItem(item["Title"]))
            result_table.setItem(row, 2, QTableWidgetItem(item["Rank"]))
            result_table.setItem(row, 3, QTableWidgetItem(item["Starting Price"]))

            if item["Image"]:
                image_path = os.path.join(self.output_folder, 'images', item["Image"])
                if os.path.exists(image_path):
                    pixmap = QPixmap(image_path)
                    pixmap = pixmap.scaled(QSize(100, 100), Qt.KeepAspectRatio, Qt.SmoothTransformation)
                    label = QLabel()
                    label.setPixmap(pixmap)
                    result_table.setCellWidget(row, 4, label)
                    result_table.setRowHeight(row, 100)
                else:
                    result_table.setItem(row, 4, QTableWidgetItem(item["Image"]))
            else:
                result_table.setItem(row, 4, QTableWidgetItem("No Image"))

            result_table.setItem(row, 5, QTableWidgetItem(item["Time"]))

        # 열 너비 조정
        result_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)

        self.result_tabs.addTab(result_table, "크롤링 결과")

        # 크롤링 완료 함수 호출
        crawling_finished(items)

        QMessageBox.information(self, "완료", f"크롤링이 완료되었고, 결과가 스프레드시트에 저장되었습니다.\n{spreadsheet_url}")

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()

    # 텔레그램 봇 실행
    bot_thread = threading.Thread(target=bot.polling, daemon=True)
    bot_thread.start()

    sys.exit(app.exec_())
