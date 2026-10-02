# PostgreSQL과 Vercel 읽기 전용 연결

수집 중인 PostgreSQL의 공식 법령을 Vercel 서버 함수가 직접 조회합니다. 별도의 Python API 서버를 먼저 배포할 필요는 없습니다. 데이터베이스 계정과 인증서는 Vercel 서버 환경에만 보관하며, 브라우저에는 법령 조회 결과만 전달합니다. 이 경로는 기관 내부 규정 편집·수집 실행·MCP 서버 연결을 제공하지 않습니다.

현재 저장소의 기존 수집기는 SQLite 기반입니다. 사용자가 별도로 구축한 PostgreSQL의 실제 테이블 구조·네트워크·권한은 아직 확인되지 않았습니다. 아래 SQL은 검토 후 적용할 매핑 예제이며, 데이터 이전이나 실제 연결이 완료됐다는 뜻이 아닙니다. 수집 중인 데이터베이스를 새로 만들거나 기존 본문을 다시 수집하지 않습니다.

## 1. 실제 스키마 확인

데이터베이스를 관리하는 터미널에서 `psql`로 접속합니다. 아래 `DB_HOST`, `DB_NAME`, `DB_OWNER`는 실제 연결 정보로 바꿉니다. 비밀번호는 `--password`가 띄우는 숨김 입력 창에 넣고 명령줄·Git·로그에 남기지 않습니다.

```bash
PGSSLMODE=verify-full psql --host DB_HOST --port 5432 \
  --dbname DB_NAME --username DB_OWNER --password
```

사설 인증 기관을 사용하면 서버 인증서를 검증할 CA 파일을 `PGSSLROOTCERT`에 지정합니다. 인증서의 호스트 이름은 연결 호스트와 일치해야 합니다. `sslmode=disable`, 인증서 검증 생략, `pg_hba.conf`의 `trust` 인증은 사용하지 않습니다.

테이블 이름과 컬럼 구조만 확인합니다. 본문이나 계정 값을 출력할 필요가 없습니다.

```sql
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name, ordinal_position;
```

Vercel이 조회하는 계약은 다음 뷰입니다.

| `public.rulecraft_official_documents` 컬럼 | 타입·의미 |
| --- | --- |
| `source` | text: `law`, `administrative`, `ordinance` 중 하나 |
| `law_id` | text: 같은 법령의 버전 간 유지되는 식별자 |
| `version_id` | text: 저장된 버전 식별자 |
| `title` | text: 법령명 |
| `effective_date` | date 또는 NULL: 시행일 |
| `publication_date` | date 또는 NULL: 공포일 |
| `source_url` | text: 인증 정보가 없는 공식 출처 URL |
| `raw_sha256` | text: 보존한 원문 응답의 SHA-256 |
| `raw_text` | text: 저장된 법령 본문 |
| `stored_at` | timestamptz: 저장·수집 시각 |

기존 SQLite `documents`와 같은 컬럼으로 PostgreSQL에 이전했다면 `text → raw_text`, `fetched_at → stored_at`으로 매핑할 수 있습니다. [SQL 예제](../deploy/postgresql-official-view.sql)가 이 경우를 다룹니다. 실제 컬럼이 다르면 예제의 SELECT를 실제 스키마에 맞춰 수정합니다. 날짜 형식과 시간대도 확인합니다.

`raw_text`는 추출한 본문이며 원본 XML/JSON 파일 바이트를 뜻하지 않습니다. `raw_sha256`에는 원본 응답의 해시를 그대로 보존합니다. 본문 문자열을 새로 해시해서 원문 해시를 덮어쓰지 않습니다. 수집기의 원문 파일·버전·체크포인트 보존 방식은 이 조회 경로와 별개입니다.

## 2. 공식 데이터만 공개하는 뷰와 계정

공개 페이지에는 이 뷰의 내용이 표시됩니다. 먼저 원천 테이블이 공개 가능한 공식 법령만 담고 있는지 확인합니다. 기관 내부 문서·개인 정보·편집 규정·API 응답에 남은 인증 값을 포함하는 테이블을 연결하지 않습니다. 원문 경로·메타데이터 JSON·OC는 뷰에 포함하지 않습니다.

검토를 마친 뒤 저장소 루트에서 실행합니다. `source_schema`와 `source_table`은 확인한 실제 이름으로 바꿉니다. `public.documents`는 구조가 일치하는 경우의 예일 뿐입니다.

```bash
PGSSLMODE=verify-full psql --host DB_HOST --port 5432 \
  --dbname DB_NAME --username DB_OWNER --password \
  -v confirmed_official_source=true \
  -v source_schema=public -v source_table=documents \
  -f deploy/postgresql-official-view.sql
```

예제는 트랜잭션 안에서 새로운 뷰와 `rulecraft_vercel_reader` 계정만 만들고 해당 뷰의 SELECT를 부여합니다. 기존 계정이나 뷰가 있으면 중단합니다. 마지막 `\password` 입력에서 전용 계정의 강한 비밀번호를 정합니다. 비밀번호를 SQL 파일에 쓰지 않습니다. 전용 계정에는 로그인·데이터베이스 CONNECT·public 스키마 USAGE·해당 뷰 SELECT만 명시적으로 부여하며, 읽기 전용 트랜잭션과 쿼리 시간 제한을 기본값으로 설정합니다.

새 계정도 `PUBLIC`에 부여된 기존 권한을 상속받습니다. 예제는 다른 사용자 테이블·뷰 접근 권한이나 public 스키마 CREATE 권한이 있으면 롤백합니다. 이 경우 기존 공유 권한을 검토해서 별도 데이터베이스로 공식 데이터 조회를 분리하거나 관련 권한을 조정합니다. 다른 서비스가 사용하는 공유 권한을 일괄 제거하지 않습니다. public CREATE가 기본으로 허용되는 이전 PostgreSQL 구성에서도 같은 검토가 필요합니다.

전용 계정으로 다시 접속해 데이터베이스 연결·공식 자료 수량·읽기 전용 설정을 확인합니다. 이 수량은 저장된 버전 수이며 현재 시행 중인 법령 수와 다를 수 있습니다.

```bash
PGSSLMODE=verify-full psql --host DB_HOST --port 5432 \
  --dbname DB_NAME --username rulecraft_vercel_reader --password
```

```sql
BEGIN READ ONLY;
SHOW transaction_read_only;
SELECT source, count(*) AS stored_versions, count(DISTINCT law_id) AS stored_documents
FROM public.rulecraft_official_documents
GROUP BY source ORDER BY source;
SELECT max(stored_at) AS last_stored_at
FROM public.rulecraft_official_documents;
ROLLBACK;
```

이 검사는 저장 건수만 조회하며 수집 테이블이나 원문을 변경하지 않습니다. 다른 기관 테이블에 SELECT·INSERT·UPDATE·DELETE 권한이 없는지도 관리자가 확인합니다. 쿼리 시간 제한이 반복해서 발생하면 관리자가 원천 테이블의 검색·식별자·저장 시각 색인을 점검합니다. Vercel 조회 계정에 색인 작성 권한을 부여하지 않습니다.

## 3. Vercel에서 접근 가능한 TLS 경로

Vercel 함수는 사용자 서버의 `localhost`, `127.0.0.1` 및 외부 경로가 없는 사설 주소에 연결할 수 없습니다. PostgreSQL에 도달하는 외부 DNS 이름과 TLS 연결 경로가 필요합니다. 실제 공개 경로가 없다면 코드 배포만으로 접속을 완료할 수 없습니다.

데이터베이스 관리자가 TLS를 설정하고 인증서의 DNS 이름을 검증합니다. Vercel 프로젝트에서 사용할 수 있는 제한된 네트워크 경로·고정 발신 IP·접속 게이트웨이 등에 맞춰 방화벽과 `pg_hba.conf`를 구성합니다. 비밀번호 인증은 SCRAM을 사용합니다. 전체 인터넷(`0.0.0.0/0`)에 인증 없는 접속이나 평문 PostgreSQL을 열지 않습니다. 임의의 HTTP 터널 주소는 PostgreSQL TCP 접속 주소로 사용할 수 없습니다. 별도 네트워크 서비스의 비용·조건은 사용 전에 확인합니다.

## 4. Vercel 서버 환경 설정

Vercel 프로젝트 **raw**의 Settings → Environment Variables에서 다음 값을 등록합니다. 이번 공개 사이트에 연결할 **Production** 범위를 선택합니다. Preview는 신뢰하는 배포가 같은 공개 법령 데이터에 접근해야 할 때만 별도로 선택하며, 포크나 검토되지 않은 코드에 운영 데이터베이스 자격 증명을 제공하지 않습니다.

| 환경 변수 | 값 |
| --- | --- |
| `RULECRAFT_DATABASE_URL` | 전용 계정의 PostgreSQL 접속 URI. `postgresql://` 또는 `postgres://` 형식 |
| `DATABASE_URL` | 위 변수가 없을 때 사용하는 대체 변수. 두 값을 동시에 넣으면 `RULECRAFT_DATABASE_URL`을 사용 |
| `RULECRAFT_DATABASE_CA` | 사설 CA를 사용할 경우 PEM 인증서 내용. 신뢰할 수 있는 공개 CA이면 생략 |
| `RULECRAFT_DATABASE_VIEW` | 다른 공개 전용 뷰를 사용할 때만 `schema.view` 형식으로 지정. 기본값은 `public.rulecraft_official_documents` |

Vercel의 **Sensitive** 옵션을 적용해 접속 URI를 보관합니다. URI의 사용자명·비밀번호에는 URL 인코딩을 적용합니다. 접속 URI와 인증서 내용은 채팅·Git·명령줄 출력·로그·`VITE_` 환경 변수에 넣지 않습니다. 서버 함수가 인증서와 호스트 이름을 검증하며 인증서 검증을 끄는 URL 옵션은 사용하지 않습니다. `RULECRAFT_LAW_OC`는 수집 서버에만 두고 Vercel에 등록하지 않습니다.

환경 변수를 저장한 뒤 **Production 재배포**를 실행합니다. 현재 데이터베이스 계정·주소를 제공하지 않은 상태에서는 Vercel이 실제 데이터를 읽었다고 표시하지 않습니다. 등록된 자격 증명으로 상태 조회와 본문 조회가 모두 성공해야 연결 검증이 완료됩니다.

접속 URI의 옵션은 `sslmode=verify-full`, `ssl=true`, `application_name`, `connect_timeout`만 허용합니다. 서버 함수가 실제 시간 제한과 TLS 검증을 설정하므로 URL 옵션으로 검증을 끌 수 없습니다. 서버 함수마다 연결 풀을 최대 2개 사용합니다. 접속자가 많아지면 데이터베이스 연결 한도와 연결 풀러를 점검합니다.

## 5. 배포 후 확인

[공개 사이트](https://raw-ecru.vercel.app/)의 **공식 법령 현황**에서 연결 상태와 자료 종류별 저장 법령 수·저장 버전 수·최근 저장 시각을 확인합니다. 법령명을 검색하고 한 건을 열어 실제 저장 본문과 출처·원문 해시가 표시되는지 확인합니다. 저장 수량이 수집 서버의 읽기 전용 검사 결과와 일치하는지도 비교합니다.

설정이 없으면 연결 설정 대기 상태로 표시합니다. TLS·네트워크·권한·뷰 구조·쿼리 제한으로 조회가 실패하면 오류 상태를 표시하며 이를 저장 0건으로 바꾸지 않습니다. 데이터베이스에 실제로 접속해서 0건이 확인됐을 때만 0건을 표시합니다. Vercel 함수는 데이터베이스에 쓰거나 수집을 시작하지 않습니다.

저장된 버전 목록은 현재 법적 효력·과거 연혁 전수·별표와 별지 원본 전체·전체 수집 완료를 증명하지 않습니다. 이 연결은 저장된 공식 자료를 조회하는 기능이며, 수집 완료 여부는 별도의 수집 체크포인트와 목록·본문 일치 검증으로 확인합니다.

법령명 검색은 제목을 조회하며 목록은 최대 50개 버전씩 반환합니다. 원문 텍스트와 직렬화한 응답은 4MB 이하로 제한합니다. 큰 자료는 저장 서버의 원본 파일에서 확인합니다. 응답 제한은 저장된 원문이나 해시를 변경하지 않습니다.
