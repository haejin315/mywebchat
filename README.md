입력창을 원하는곳에 생성, 채팅 입력하면 글자가 떨어져 버리는 이상한 채팅 웹입니다.

MyWebChat – CI/CD 기반 배포 자동화 구축 기록

1. 프로젝트 개요
  이 프로젝트는
  Go 기반 WebSocket 채팅 서버 + 정적 웹 프론트엔드를 대상으로,
  로컬 개발
  Docker 컨테이너화
  GitHub Actions 기반 CI
  AWS EC2 운영 환경
  SSH 없는 SSM 기반 배포 자동화
  까지 엔드 투 엔드 배포 파이프라인를 직접 설계·구현한 프로젝트입니다.

2. 전체 아키텍처
  [ Local 개발 ]
     ↓ git push
  [ GitHub Actions ]
     - Docker build
     - GHCR push
     ↓
  [ AWS SSM ]
     - Run Command
     ↓
  [ EC2 ]
     - docker compose pull
     - docker compose up -d
     - nginx reverse proxy
  
  핵심 특징
  SSH 접속 제거
  EC2 인바운드 IP 관리 제거
  AWS SSM을 통한 명령 실행
  이미지 기반 배포

3. 사용 기술 스택
  Backend
    Go (WebSocket 기반 채팅 서버)
  Frontend
    HTML / CSS / JavaScript
    Nginx를 통한 정적 파일 서빙
  Container / Infra
    Docker
    Docker Compose
    Nginx (Reverse Proxy)
  CI/CD
    GitHub Actions
    GitHub Container Registry (GHCR)
  Cloud / Ops
    AWS EC2
    AWS IAM
    AWS Systems Manager (SSM)

4. Docker & 서비스 구성
  서비스 분리
    mywebchat-app
      Go 서버
      WebSocket /ws 엔드포인트 제공
    mywebchat-nginx
      정적 파일 서빙
      /ws 요청을 app 컨테이너로 프록시
  
  docker-compose 구조
    EC2에서는 build 없이 image pull만 수행
    로컬/CI에서만 build
  
  services:
    app:
      image: ghcr.io/haejin315/mywebchat-app:latest
  
    nginx:
      image: ghcr.io/haejin315/mywebchat-nginx:latest
      ports:
        - "80:80"
        
5. CI: GitHub Actions (Build & Push)
  동작 트리거
    main 브랜치 push 시 자동 실행
  수행 작업
    코드 체크아웃
    Docker Buildx 설정
    GHCR 로그인
    App 이미지 빌드 & Push
    Nginx 이미지 빌드 & Push
  이미지 태깅 전략
    latest
    ${GITHUB_SHA}
  → 롤백 가능성 확보

6. CD: AWS SSM 기반 배포
  왜 SSM을 선택했는가?
  기존 SSH 기반 배포는 다음 문제를 가짐:
    보안 그룹에 22번 포트 개방 필요
    GitHub Actions IP 관리 필요
    SSH Key 관리 필요
  → SSM을 사용해 전부 제거
  
  배포 방식
  GitHub Actions에서:
    
  aws ssm send-command \
    --document-name AWS-RunShellScript \
    --instance-ids <EC2_ID>
      
  EC2 내부에서 실행되는 명령:
  docker login ghcr.io
  docker compose pull
  docker compose up -d
  docker image prune -f
    
  장점
    SSH 완전 제거
    인바운드 규칙: HTTP(80), HTTPS(443)만 허용
    IAM 기반 접근 제어
    배포 기록이 AWS에 남음

7. 인증 / 보안 설계
  GHCR 인증
    Fine-grained Personal Access Token
  최소 권한:
    Packages: Read
    Contents: Read
  EC2에서는 Pull 전용 토큰 사용
  
  AWS 권한
    EC2 IAM Role:
      AmazonSSMManagedInstanceCore
    GitHub Actions IAM User:
      SSM SendCommand 권한
      EC2 ReadOnly

8. 트러블슈팅 경험 (핵심 학습)
  SSM 기본 Shell 이슈
    AWS-RunShellScript는 /bin/sh 기반
    set -o pipefail 미지원
    bash 전용 옵션 제거로 해결
  GHCR 인증 실패
    GITHUB_TOKEN은 외부 서버 pull 불가
    Fine-grained PAT로 전환
  root vs ubuntu 환경 차이
    SSM은 root로 실행
    기존 docker login 기록 미사용
    매 배포 시 명시적 로그인

9. 배포 자동화의 최종 상태
  현재 달성한 것
    코드 push → 자동 배포
    서버 무접속 배포
    이미지 기반 일관된 실행 환경
    보안 그룹 최소화
    재현 가능한 배포 파이프라인

10. 회고
  이 프로젝트를 통해 단순한 기능 구현을 넘어,
  운영 관점에서의 문제
  보안과 자동화의 균형
  실제 장애 원인 추적 능력
  을 경험할 수 있었습니다.
  특히 SSH 없이 SSM 기반으로 배포를 구성하며,
  어떻게 하면 사람이 개입하지 않아도 안전하게 운영할 수 있는가에 대한 고민을 실제로 구현해본 경험이 되었습니다.

11. 향후 개선 방향
  HTTPS + Certbot 자동화
  무중단 배포 전략
  헬스체크 기반 배포 검증
  ECS/Fargate 전환 검토
